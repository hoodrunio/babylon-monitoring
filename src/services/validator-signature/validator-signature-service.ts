import { BabylonClient } from '../../clients/babylon-client.interface';
import { MonitoringService, MonitoringServiceOptions } from '../monitoring-service.interface';
import { Network } from '../../config/config';
import logger from '../../utils/logger';
import { ServiceConstants } from './types';
import { ValidatorApiClient } from './api-client';
import { CacheManager } from './cache-manager';
import { BlockProcessor } from './block-processor';
import { ValidatorManager } from './validator-manager';
import { StatsManager } from './stats-manager';
import { NotificationService } from './notification-service';

/**
 * Validator signature monitoring service
 */
export class ValidatorSignatureService implements MonitoringService {
  private client: BabylonClient | null = null;
  private options: MonitoringServiceOptions | null = null;
  
  // Sub-services
  private apiClient: ValidatorApiClient | null = null;
  private cacheManager: CacheManager | null = null;
  private blockProcessor: BlockProcessor | null = null;
  private validatorManager: ValidatorManager | null = null;
  private statsManager: StatsManager | null = null;
  private notificationService: NotificationService | null = null;
  
  // Constants
  private readonly constants: ServiceConstants = {
    BLOCK_ID_FLAG_COMMIT: 2,
    BLOCK_ID_FLAG_COMMIT_STR: "BLOCK_ID_FLAG_COMMIT",
    RECENT_BLOCKS_LIMIT: 100,
    SIGNATURE_PERFORMANCE_WINDOW: 10000,
    MAX_CACHE_SIZE: 1000
  };

  // Validator status tracking
  private validatorJailedStatus: Map<string, boolean> = new Map();
  private validatorActiveStatus: Map<string, string> = new Map();
  private validatorJailedCheckInterval: NodeJS.Timeout | null = null;
  private validatorStatusCheckInterval: NodeJS.Timeout | null = null;
  private readonly JAILED_CHECK_INTERVAL = 5 * 60 * 1000; // Check every 5 minutes
  private readonly STATUS_CHECK_INTERVAL = 5 * 60 * 1000; // Check every 5 minutes

  async initialize(client: BabylonClient, options: MonitoringServiceOptions): Promise<void> {
    this.client = client;
    this.options = options;

    if (!options.enabled) {
      logger.info(`ValidatorSignatureService is disabled for ${options.network} network`);
      return;
    }

    logger.info(`Initializing ValidatorSignatureService for ${options.network} network`);
    
    try {
      // Initialize services
      this.initializeServices();
      
      // Load validator information
      await this.validatorManager!.loadValidatorInfo();
      
      // Initial jailed status check
      await this.checkValidatorJailedStatus();
      
      // Initial active/inactive status check
      await this.checkValidatorActiveStatus();
      
      logger.info(`ValidatorSignatureService initialized for ${options.network} network`);
    } catch (error) {
      logger.error({ error }, `ValidatorSignatureService initialization error (${options.network})`);
      throw error;
    }
  }

  /**
   * Initializes sub-services
   */
  private initializeServices(): void {
    // API client
    this.apiClient = new ValidatorApiClient(this.client!);
    
    // Cache manager
    this.cacheManager = new CacheManager(this.constants);
    
    // Notification service
    this.notificationService = new NotificationService(
      this.getNetwork(),
      this.options!
    );
    
    // Validator manager
    this.validatorManager = new ValidatorManager(this.getNetwork());
    
    // Stats manager
    this.statsManager = new StatsManager(
      this.getNetwork(),
      this.options!,
      this.notificationService,
      this.constants
    );
    
    // Block processor
    this.blockProcessor = new BlockProcessor(
      this.apiClient,
      this.cacheManager,
      this.constants,
      this.getNetwork(),
      this.onBlockProcessed.bind(this)
    );
  }

  async start(): Promise<void> {
    if (!this.isEnabled()) return;
    
    // Periodically check validator jailed status
    this.validatorJailedCheckInterval = setInterval(
      this.checkValidatorJailedStatus.bind(this),
      this.JAILED_CHECK_INTERVAL
    );
    
    // Periodically check validator active/inactive status
    this.validatorStatusCheckInterval = setInterval(
      this.checkValidatorActiveStatus.bind(this),
      this.STATUS_CHECK_INTERVAL
    );
    
    logger.info(`ValidatorSignatureService started for ${this.getNetwork()} network`);
  }

  async stop(): Promise<void> {
    // Stop jailed status check
    if (this.validatorJailedCheckInterval) {
      clearInterval(this.validatorJailedCheckInterval);
      this.validatorJailedCheckInterval = null;
    }
    
    // Stop active/inactive status check
    if (this.validatorStatusCheckInterval) {
      clearInterval(this.validatorStatusCheckInterval);
      this.validatorStatusCheckInterval = null;
    }
    
    logger.info(`ValidatorSignatureService stopped for ${this.getNetwork()} network`);
  }

  /**
   * Checks the jailed status of validators
   */
  private async checkValidatorJailedStatus(): Promise<void> {
    if (!this.isEnabled() || !this.apiClient) return;
    
    try {
      const validators = await this.apiClient.getAllValidators();
      
      // Check all validators
      for (const validator of validators) {
        const isJailed = validator.jailed === true;
        const operatorAddress = validator.operator_address;
        
        // Compare with previous status
        const wasJailed = this.validatorJailedStatus.get(operatorAddress) || false;
        
        // If the status has changed
        if (isJailed !== wasJailed) {
          // Send a notification if jailed
          if (isJailed) {
            await this.notificationService?.sendValidatorJailedAlert(
              operatorAddress,
              validator.description?.moniker || operatorAddress
            );
            logger.info(`Validator jailed: ${operatorAddress} (${validator.description?.moniker || 'unknown'})`);
          } else {
            await this.notificationService?.sendValidatorUnjailedAlert(
              operatorAddress,
              validator.description?.moniker || operatorAddress
            );
            logger.info(`Validator unjailed: ${operatorAddress} (${validator.description?.moniker || 'unknown'})`);
          }
        }
        
        // Update status
        this.validatorJailedStatus.set(operatorAddress, isJailed);
      }
    } catch (error) {
      logger.error({ error }, 'Error checking validator jailed status');
    }
  }

  /**
   * Checks the active/inactive status of validators
   */
  private async checkValidatorActiveStatus(): Promise<void> {
    if (!this.isEnabled() || !this.apiClient) return;
    
    try {
      const validators = await this.apiClient.getAllValidators();
      
      // Check all validators
      for (const validator of validators) {
        const status = validator.status;
        const operatorAddress = validator.operator_address;
        const moniker = validator.description?.moniker || operatorAddress;
        
        // Compare with previous status
        const previousStatus = this.validatorActiveStatus.get(operatorAddress) || '';
        
        // If the status has changed
        if (status !== previousStatus && previousStatus !== '') {
          // If active (BOND_STATUS_BONDED)
          if (status === 'BOND_STATUS_BONDED') {
            await this.notificationService?.sendValidatorActiveAlert(operatorAddress, moniker);
            logger.info(`Validator is now active: ${operatorAddress} (${moniker})`);
          } 
          // If inactive (BOND_STATUS_UNBONDING or BOND_STATUS_UNBONDED)
          else if (previousStatus === 'BOND_STATUS_BONDED') {
            await this.notificationService?.sendValidatorInactiveAlert(operatorAddress, moniker, status);
            logger.info(`Validator is now inactive: ${operatorAddress} (${moniker}) - Status: ${status}`);
          }
        }
        
        // Update status
        this.validatorActiveStatus.set(operatorAddress, status);
      }
    } catch (error) {
      logger.error({ error }, 'Error checking validator active status');
    }
  }

  /**
   * Called when a new block arrives from the blockchain
   * This method is required for the MonitoringService interface
   */
  async handleNewBlock(height: number): Promise<void> {
    if (!this.isEnabled()) return;
    logger.info(`New block reported: ${this.getNetwork()} - ${height}`);
    // This method no longer makes any REST API calls
    // The handleWebSocketBlock method should be used when new block data arrives via WebSocketManager
  }

  /**
   * Processes block data from WebSocket
   */
  async handleWebSocketBlock(blockData: any): Promise<void> {
    if (!this.isEnabled()) return;
    await this.blockProcessor!.processBlockData(blockData);
  }

  /**
   * Called when a block is processed by the block processor
   */
  private async onBlockProcessed(height: number, signers: Set<string>, timestamp: Date, round: number): Promise<void> {
    if (!this.isEnabled() || !this.validatorManager) return;
    
    try {
      // Get all active validators
      const allValidators = await this.validatorManager.getAllValidators();
      
      // For each validator, check if they signed and update
      for (const validator of allValidators) {
        if (!validator.operator_address) continue;
        
        // Check if the validator is active (bonded)
        const isActive = validator.status === 'BOND_STATUS_BONDED';
        
        // Update signatures of active validators, skip inactive ones
        if (isActive) {
          // Did it sign?
          const hasSigned = signers.has(validator.operator_address);
          
          await this.statsManager!.updateValidatorSignature(
            validator,
            height,
            timestamp,
            round,
            hasSigned // signing status
          );
        }
      }
    } catch (error) {
      logger.error({ error, height }, 'Error processing block signatures');
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
    return 'ValidatorSignatureService';
  }

  /**
   * Returns the network name
   */
  getNetwork(): Network {
    return this.options?.network || Network.MAINNET;
  }
}

// Singleton instance
const validatorSignatureService = new ValidatorSignatureService();
export default validatorSignatureService;