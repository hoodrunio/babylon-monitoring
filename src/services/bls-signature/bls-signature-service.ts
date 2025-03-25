import { BabylonClient } from '../../clients/babylon-client.interface';
import { MonitoringService, MonitoringServiceOptions } from '../monitoring-service.interface';
import { Network } from '../../config/config';
import logger from '../../utils/logger';
import { BLSValidatorSignature, BLSCheckpointStats } from '../../models/bls-signature.model';
import blsSignatureRepository from '../../database/repositories/bls-signature.repository';
import { ServiceConstants } from './types';
import { BLSApiClient } from './api-client';
import { ValidatorManager } from './validator-manager';
import { EpochManager } from './epoch-manager';
import { CheckpointProcessor } from './checkpoint-processor';
import { NotificationService } from './notification-service';

/**
 * BLS signature monitoring service
 */
export class BLSSignatureService implements MonitoringService {
  private client: BabylonClient | null = null;
  private options: MonitoringServiceOptions | null = null;
  
  // Sub-services
  private apiClient: BLSApiClient | null = null;
  private validatorManager: ValidatorManager | null = null;
  private epochManager: EpochManager | null = null;
  private checkpointProcessor: CheckpointProcessor | null = null;
  private notificationService: NotificationService | null = null;
  
  // Constants
  private readonly constants: ServiceConstants = {
    EPOCH_BLOCKS: 360,
    BLOCK_ID_FLAG_COMMIT_STR: "BLOCK_ID_FLAG_COMMIT"
  };

  async initialize(client: BabylonClient, options: MonitoringServiceOptions): Promise<void> {
    this.client = client;
    this.options = options;

    if (!options.enabled) {
      logger.info(`BLSSignatureService is disabled for ${options.network} network`);
      return;
    }

    logger.info(`Initializing BLSSignatureService for ${options.network} network`);
    
    try {
      // Initialize repository
      await blsSignatureRepository.initialize();
      
      // Initialize sub-services
      this.initializeServices();
      
      // Load validator information
      await this.validatorManager!.loadValidatorInfo();
      
      // Fetch the current epoch
      await this.epochManager!.fetchCurrentEpoch();
      
      logger.info(`BLSSignatureService initialized for ${options.network} network, current epoch: ${this.epochManager!.getCurrentEpoch()}`);
    } catch (error) {
      logger.error({ error }, `BLSSignatureService initialization error (${options.network})`);
      throw error;
    }
  }

  /**
   * Initializes sub-services
   */
  private initializeServices(): void {
    // API client
    this.apiClient = new BLSApiClient(this.client!);
    
    // Validator manager
    this.validatorManager = new ValidatorManager(this.apiClient);
    
    // Epoch manager
    this.epochManager = new EpochManager(this.apiClient, this.constants);
    
    // Notification service
    this.notificationService = new NotificationService(
      this.getNetwork(),
      this.options!
    );
    
    // Checkpoint processor
    this.checkpointProcessor = new CheckpointProcessor(
      this.apiClient,
      this.validatorManager,
      this.epochManager,
      this.constants,
      this.getNetwork(),
      this.onCheckpointProcessed.bind(this)
    );
  }

  async start(): Promise<void> {
    if (!this.isEnabled()) return;
    logger.info(`BLSSignatureService started for ${this.getNetwork()} network`);
  }

  async stop(): Promise<void> {
    logger.info(`BLSSignatureService stopped for ${this.getNetwork()} network`);
  }

  /**
   * Called when a new block arrives
   */
  async handleNewBlock(height: number): Promise<void> {
    if (!this.isEnabled() || !this.client) return;

    try {
      // Update epoch information periodically
      if (height % 50 === 0) {
        await this.epochManager!.fetchCurrentEpoch();
      }
    } catch (error) {
      logger.error({ error, height }, 'BLS epoch update error');
    }
  }

  /**
   * Called when a BLS checkpoint is received
   */
  async handleBLSCheckpoint(epochNum: number): Promise<void> {
    if (!this.isEnabled() || !this.client) return;
    
    await this.checkpointProcessor!.processCheckpoint(epochNum);
  }

  /**
   * Called when a checkpoint is processed
   */
  private async onCheckpointProcessed(
    epochNum: number, 
    signatures: BLSValidatorSignature[], 
    stats: BLSCheckpointStats
  ): Promise<void> {
    try {
      // Save all validator signatures
      for (const signature of signatures) {
        await blsSignatureRepository.saveSignature(signature);
      }
      
      // Save checkpoint statistics
      await blsSignatureRepository.saveCheckpointStats(stats);
      
      // Check tracked validators and send alerts
      await this.notificationService!.checkTrackedValidators(epochNum, signatures);
      
      // Check participation rate
      await this.notificationService!.checkParticipationRate(stats);
    } catch (error) {
      logger.error({ error, epochNum, network: this.getNetwork() }, 'Error processing checkpoint data');
    }
  }

  /**
   * Checks whether the service is enabled
   */
  isEnabled(): boolean {
    return this.options?.enabled === true;
  }

  /**
   * Returns the service name
   */
  getName(): string {
    return 'BLSSignatureService';
  }

  /**
   * Returns the network name
   */
  getNetwork(): Network {
    return this.options?.network || Network.MAINNET;
  }
}

// Singleton instance
const blsSignatureService = new BLSSignatureService();
export default blsSignatureService; 