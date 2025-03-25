import { BabylonClient } from '../../clients/babylon-client.interface';
import { MonitoringService, MonitoringServiceOptions } from '../monitoring-service.interface';
import { Network } from '../../config/config';
import logger from '../../utils/logger';
import { ServiceConstants } from './types';
import { FinalityProviderApiClient } from './api-client';
import { CacheManager } from './cache-manager';
import { BlockProcessor } from './block-processor';
import { NotificationService } from './notification-service';
import { StatsManager } from './stats-manager';
import { ProviderManager } from './provider-manager';
import { EpochManager } from './epoch-manager';
import { SyncManager } from './sync-manager';

/**
 * Finality Provider monitoring service
 */
export class FinalityProviderService implements MonitoringService {
  private client: BabylonClient | null = null;
  private options: MonitoringServiceOptions | null = null;
  
  // Sub-services
  private apiClient: FinalityProviderApiClient | null = null;
  private cacheManager: CacheManager | null = null;
  private blockProcessor: BlockProcessor | null = null;
  private notificationService: NotificationService | null = null;
  private statsManager: StatsManager | null = null;
  private providerManager: ProviderManager | null = null;
  private epochManager: EpochManager | null = null;
  private syncManager: SyncManager | null = null;
  
  // Constants
  private readonly constants: ServiceConstants = {
    MAX_CACHE_SIZE: 1000,
    FINALIZED_BLOCKS_WAIT: 3,
    EPOCH_BLOCKS: 360,
    MAX_SYNC_BLOCKS: 100,
    SYNC_GAP_THRESHOLD: 100,
    SIGNATURE_RATE_THRESHOLD_STEPS: 5
  };

  async initialize(client: BabylonClient, options: MonitoringServiceOptions): Promise<void> {
    this.client = client;
    this.options = options;

    if (!options.enabled) {
      logger.info(`FinalityProviderService is disabled for ${options.network} network`);
      return;
    }

    logger.info(`Initializing FinalityProviderService for ${options.network} network`);
    
    try {
      // Create sub-services
      this.initializeServices();
      
      // Load finality provider information
      await this.providerManager!.loadFinalityProviderInfo();

      // Load initial active finality provider list
      try {
        // Get the latest block height
        const currentHeight = await this.client.getCurrentHeight();
        
        // Fetch the current epoch
        await this.epochManager!.fetchCurrentEpoch();
        
        // Update active finality providers
        await this.providerManager!.updateActiveFinalityProviders(currentHeight);
        
        // Update all statistics with activity information
        await this.statsManager!.updateAllFinalityProviderStats();
        
        // Set the current epoch as the last update epoch
        this.epochManager!.updateLastCheckedEpoch();
        
        // Perform initial synchronization
        await this.syncManager!.performInitialSync();
      } catch (error) {
        logger.warn({ error }, 'Error occurred during initial setup');
      }
      
      logger.info(`FinalityProviderService initialized for ${options.network} network, current epoch: ${this.epochManager!.getCurrentEpoch()}, epoch boundary: ${this.epochManager!.getCurrentEpochBoundary()}`);
    } catch (error) {
      logger.error({ error }, `FinalityProviderService initialization error (${options.network})`);
      throw error;
    }
  }

  /**
   * Initializes sub-services
   */
  private initializeServices(): void {
    // API client
    this.apiClient = new FinalityProviderApiClient(this.client!);
    
    // Cache manager
    this.cacheManager = new CacheManager(this.constants);
    
    // Notification service
    this.notificationService = new NotificationService(
      this.getNetwork(), 
      this.options!,
      this.constants.SIGNATURE_RATE_THRESHOLD_STEPS
    );
    
    // Provider manager
    this.providerManager = new ProviderManager(
      this.apiClient,
      this.notificationService,
      this.getNetwork()
    );
    
    // Epoch manager
    this.epochManager = new EpochManager(this.apiClient, this.constants);
    
    // Stats manager (must be created after provider manager)
    this.statsManager = new StatsManager(
      this.getNetwork(),
      this.options!,
      this.notificationService,
      this.providerManager.getActiveProviders(),
      this.providerManager.getProviderMap()
    );
    
    // Block processor (must be created last, depends on other services)
    this.blockProcessor = new BlockProcessor(
      this.apiClient,
      this.cacheManager,
      this.constants,
      this.getNetwork(),
      this.onBlockProcessed.bind(this)
    );
    
    // Sync manager
    this.syncManager = new SyncManager(
      this.apiClient,
      this.constants,
      this.getNetwork(),
      this.processBlockAtHeight.bind(this)
    );
  }

  async start(): Promise<void> {
    if (!this.isEnabled()) return;
    logger.info(`FinalityProviderService started for ${this.getNetwork()} network`);
  }

  async stop(): Promise<void> {
    logger.info(`FinalityProviderService stopped for ${this.getNetwork()} network`);
  }

  /**
   * Called when a new block arrives
   */
  async handleNewBlock(height: number): Promise<void> {
    if (!this.isEnabled() || !this.client) return;

    // Check epoch every 50 blocks
    if (this.epochManager!.shouldUpdateEpoch(height)) {
      await this.epochManager!.fetchCurrentEpoch();
    }
    
    // If the current block has reached the epoch boundary or a new epoch has started, update the finality providers
    if (this.epochManager!.shouldUpdateFinalityProviders(height)) {
      logger.info(`Epoch boundary or new epoch detected: ${this.epochManager!.getCurrentEpoch()}, block: ${height}`);
      await this.providerManager!.updateActiveFinalityProviders(height);
      await this.statsManager!.updateAllFinalityProviderStats();
      
      // Save the last update epoch
      this.epochManager!.updateLastCheckedEpoch();
      
      // Update the epoch boundary for the next epoch
      this.epochManager!.updateEpochBoundary(height);
    }
    
    // Add block to queue
    this.blockProcessor!.addBlockToQueue(height);
    
    // Process the queue
    await this.blockProcessor!.processBlockQueue();
  }

  /**
   * Called when a block is processed (by Block Processor)
   */
  private async onBlockProcessed(height: number, signers: Set<string>): Promise<void> {
    await this.processBlockSignatures(height, signers);
  }
  
  /**
   * Block processing during synchronization (by SyncManager)
   */
  private async processBlockAtHeight(height: number): Promise<void> {
    try {
      // Fetch votes at this height
      const votes = await this.apiClient!.getVotesAtHeight(height);
      
      if (!votes || !votes.btc_pks || votes.btc_pks.length === 0) {
        logger.warn({ height }, 'Synchronization: Finality provider votes not found');
        return;
      }
      
      // Process votes
      const signers = new Set(votes.btc_pks);
      
      // Cache votes
      this.cacheManager!.cacheVotes(height, signers);
      
      // Save signatures
      await this.processBlockSignatures(height, signers);
      
      if (height % 20 === 0) {
        logger.debug({ height, signerCount: signers.size }, 'Synchronization: Block processed');
      }
    } catch (error) {
      logger.error({ error, height }, 'Synchronization: Block processing error');
    }
  }
  
  /**
   * Processes and saves block signatures
   */
  private async processBlockSignatures(height: number, signers: Set<string>): Promise<void> {
    // Record signature status for all providers
    for (const [fpBtcPkHex, fpInfo] of this.providerManager!.getProviderMap().entries()) {
      // Determine signature status (whether signed or not)
      const signed = signers.has(fpBtcPkHex);

      // Check tracking list
      if (this.statsManager!.shouldTrackProvider(fpBtcPkHex)) {
        await this.statsManager!.updateFinalityProviderStatsWithSignature(fpBtcPkHex, height, signed);
      }
    }
  }

  isEnabled(): boolean {
    return this.options?.enabled === true;
  }

  getName(): string {
    return 'FinalityProviderService';
  }

  getNetwork(): Network {
    return this.options?.network || Network.MAINNET;
  }
} 