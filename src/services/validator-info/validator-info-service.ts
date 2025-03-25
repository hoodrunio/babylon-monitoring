import { BabylonClient } from '../../clients/babylon-client.interface';
import { MonitoringService, MonitoringServiceOptions } from '../monitoring-service.interface';
import { Network } from '../../config/config';
import logger from '../../utils/logger';
import { ValidatorInfo } from '../../models/validator-info.model';
import validatorInfoRepository from '../../database/repositories/validator-info.repository';
import { ObjectId } from 'mongodb';
import { ServiceConstants } from './types';
import { ValidatorInfoApiClient } from './api-client';
import { AddressConverter } from './address-converter';
import { ValidatorProcessor } from './validator-processor';
import { UpdateScheduler } from './update-scheduler';

/**
 * Service class that manages validator information
 */
export class ValidatorInfoService implements MonitoringService {
  private client: BabylonClient | null = null;
  private options: MonitoringServiceOptions | null = null;
  
  // Sub-services
  private apiClient: ValidatorInfoApiClient | null = null;
  private addressConverter: AddressConverter | null = null;
  private validatorProcessor: ValidatorProcessor | null = null;
  private updateScheduler: UpdateScheduler | null = null;
  
  // Constants
  private readonly constants: ServiceConstants = {
    UPDATE_INTERVAL: 60 * 60 * 1000 // 1 hour
  };

  /**
   * Initializes the service
   */
  async initialize(client: BabylonClient, options: MonitoringServiceOptions): Promise<void> {
    this.client = client;
    this.options = options;

    if (!options.enabled) {
      logger.info(`ValidatorInfoService is disabled for ${options.network} network`);
      return;
    }

    logger.info(`Initializing ValidatorInfoService for ${options.network} network`);
    
    try {
      // Initialize validator info repository
      await validatorInfoRepository.initialize();
      
      // Initialize sub-services
      this.initializeServices();
      
      // Load validator information
      await this.loadValidators();
      
      logger.info(`ValidatorInfoService initialized for ${options.network} network`);
    } catch (error) {
      logger.error({ error }, `ValidatorInfoService initialization error (${options.network})`);
      throw error;
    }
  }

  /**
   * Initializes sub-services
   */
  private initializeServices(): void {
    // API client
    this.apiClient = new ValidatorInfoApiClient(this.client!);
    
    // Address converter
    this.addressConverter = new AddressConverter();
    
    // Validator processor
    this.validatorProcessor = new ValidatorProcessor(
      this.addressConverter,
      this.getNetwork()
    );
    
    // Update scheduler
    this.updateScheduler = new UpdateScheduler(
      this.constants,
      this.getNetwork(),
      this.loadValidators.bind(this)
    );
  }

  /**
   * Loads validators from the API and processes them
   */
  private async loadValidators(): Promise<void> {
    try {
      const validators = await this.apiClient!.getAllValidators();
      await this.validatorProcessor!.processValidators(validators);
      
      logger.info(`Validators loaded successfully: ${validators.length} for ${this.getNetwork()}`);
    } catch (error) {
      logger.error({ error, network: this.getNetwork() }, 'Error loading validators');
      throw error;
    }
  }

  /**
   * Starts the service
   */
  async start(): Promise<void> {
    if (!this.isEnabled()) return;
    
    logger.info(`ValidatorInfoService started for ${this.getNetwork()} network`);
    
    // Start periodic update
    this.updateScheduler!.startPeriodicUpdates();
  }

  /**
   * Stops the service
   */
  async stop(): Promise<void> {
    if (this.updateScheduler) {
      this.updateScheduler.clearScheduler();
    }
    
    logger.info(`ValidatorInfoService stopped for ${this.getNetwork()} network`);
  }

  /**
   * Gets validator information by any address format
   */
  async getValidatorByAnyAddress(address: string): Promise<ValidatorInfo | null> {
    try {
      // Check cache first
      const cachedValidator = this.validatorProcessor!.getValidatorByAddress(address);
      if (cachedValidator) {
        return cachedValidator;
      }
      
      // If not in cache, search in database
      return validatorInfoRepository.findByAnyAddress(address, this.getNetwork());
    } catch (error) {
      logger.error({ error, address }, 'Error searching for validator by any address');
      throw error;
    }
  }

  /**
   * Gets validator information by ID
   */
  async getValidatorById(id: ObjectId): Promise<ValidatorInfo | null> {
    try {
      // Get all validators and find by ID
      const validators = await validatorInfoRepository.getAllValidators(this.getNetwork());
      return validators.find(v => v._id && v._id.equals(id)) || null;
    } catch (error) {
      logger.error({ error, id }, 'Error getting validator by ID');
      throw error;
    }
  }

  /**
   * Returns all validators
   */
  async getAllValidators(limit: number = 1000): Promise<ValidatorInfo[]> {
    try {
      // If validator processor has validators and number is below limit, return from cache
      if (
        this.validatorProcessor &&
        !this.validatorProcessor.isValidatorMapEmpty() &&
        this.validatorProcessor.getValidatorCount() <= limit
      ) {
        return Array.from(this.validatorProcessor.getValidatorInfoMap().values());
      }
      
      // Otherwise get from database
      return validatorInfoRepository.getAllValidators(this.getNetwork(), limit);
    } catch (error) {
      logger.error({ error }, 'Error getting all validators');
      throw error;
    }
  }

  /**
   * A new block is processed (for MonitoringService interface)
   */
  async handleNewBlock(height: number): Promise<void> {
    // Block-based processing is not required for this service
    // Validator information is updated periodically
    return;
  }

  /**
   * Checks if the service is active
   */
  isEnabled(): boolean {
    return this.options !== null && this.options.enabled === true;
  }

  /**
   * Returns the service name
   */
  getName(): string {
    return `ValidatorInfoService-${this.getNetwork()}`;
  }

  /**
   * Returns the network
   */
  getNetwork(): Network {
    return this.options?.network || Network.MAINNET;
  }
}

// Singleton instance
const validatorInfoService = new ValidatorInfoService();
export default validatorInfoService; 