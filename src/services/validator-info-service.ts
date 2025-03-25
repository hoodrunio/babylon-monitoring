import { BabylonClient } from '../clients/babylon-client.interface';
import { MonitoringService, MonitoringServiceOptions } from './monitoring-service.interface';
import { Network } from '../config/config';
import logger from '../utils/logger';
import { ValidatorInfo } from '../models/validator-info.model';
import validatorInfoRepository from '../database/repositories/validator-info.repository';
import { addressConverter } from '../utils/address-converter';
import { ObjectId } from 'mongodb';

interface ValidatorResponse {
  validators: Array<{
    operator_address: string;
    consensus_pubkey: {
      type?: string;
      key: string;
    };
    description: {
      moniker: string;
      details?: string;
      website?: string;
      identity?: string;
      security_contact?: string;
    };
    status: string;
    tokens: string;
    delegator_shares?: string;
    jailed?: boolean;
    unbonding_height?: string;
    unbonding_time?: string;
    commission: {
      commission_rates: {
        rate: string;
        max_rate: string;
        max_change_rate: string;
      };
      update_time: string;
    };
    min_self_delegation?: string;
  }>;
  pagination: {
    total: string;
    next_key: string | null;
  };
}

/**
 * Service class that manages validator information
 */
export class ValidatorInfoService implements MonitoringService {
  private client: BabylonClient | null = null;
  private options: MonitoringServiceOptions | null = null;
  private validatorInfoMap: Map<string, ValidatorInfo> = new Map();
  private readonly UPDATE_INTERVAL = 60 * 60 * 1000; // 1 hour
  private updateTimer: NodeJS.Timeout | null = null;

  /**
   * Initializes the service
   * @param client Babylon client
   * @param options Options
   */
  async initialize(client: BabylonClient, options: MonitoringServiceOptions): Promise<void> {
    this.client = client;
    this.options = options;

    if (!options.enabled) {
      logger.info(`ValidatorInfoService is disabled for ${options.network} network`);
      return;
    }

    logger.info(`ValidatorInfoService is starting for ${options.network} network`);
    
    try {
      // Initialize validator info repository
      await validatorInfoRepository.initialize();
      
      // Load validator information
      await this.loadValidatorsFromAPI();
      
      logger.info(`ValidatorInfoService started for ${options.network} network`);
    } catch (error) {
      logger.error({ error }, `ValidatorInfoService initialization error (${options.network})`);
      throw error;
    }
  }

  /**
   * Starts the service
   */
  async start(): Promise<void> {
    if (!this.isEnabled()) return;
    
    logger.info(`ValidatorInfoService started for ${this.getNetwork()} network`);
    
    // Schedule periodic update
    this.schedulePeriodidUpdate();
  }

  /**
   * Stops the service
   */
  async stop(): Promise<void> {
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = null;
    }
    
    logger.info(`ValidatorInfoService stopped for ${this.getNetwork()} network`);
  }

  /**
   * Retrieves all validator information from the API and saves it to the database
   */
  private async loadValidatorsFromAPI(): Promise<void> {
    try {
      const validators = await this.getValidators();
      logger.info(`${validators.length} validators fetched from ${this.getNetwork()} network`);
      
      // Clear validator info map first
      this.validatorInfoMap.clear();
      
      // For each validator
      for (const validator of validators) {
        try {
          // Create consensus address
          const consensusPubkey = validator.consensus_pubkey.key;
          const consensusAddress = this.pubkeyToConsAddress(consensusPubkey);
          
          // Create hex address
          const hexAddress = await addressConverter.bech32ToHex(consensusAddress);
          
          // Create validator information
          const validatorInfo: ValidatorInfo = {
            validator_address: consensusAddress,
            validator_hex_address: hexAddress,
            operator_address: validator.operator_address,
            consensus_pubkey: validator.consensus_pubkey,
            moniker: validator.description.moniker,
            description: validator.description,
            tokens: validator.tokens,
            voting_power: this.calculateVotingPower(validator.tokens),
            commission: {
              rate: validator.commission.commission_rates.rate,
              max_rate: validator.commission.commission_rates.max_rate,
              max_change_rate: validator.commission.commission_rates.max_change_rate
            },
            status: validator.status,
            network: this.getNetwork(),
            alternative_addresses: {
              bech32: [consensusAddress],
              hex: [hexAddress]
            },
            last_updated: new Date()
          };
          
          // Save to database
          const validatorId = await validatorInfoRepository.saveValidator(validatorInfo);
          
          // Add to map
          this.validatorInfoMap.set(consensusAddress, validatorInfo);
          
          logger.debug({ 
            validator_address: consensusAddress, 
            hex_address: hexAddress,
            operator_address: validator.operator_address,
            moniker: validator.description.moniker
          }, 'Validator information updated');
        } catch (error) {
          logger.error({ error, validator }, 'Error saving validator information');
        }
      }
      
      logger.info(`${this.validatorInfoMap.size} validator information loaded for ${this.getNetwork()}`);
    } catch (error) {
      logger.error({ error }, 'Error loading validator information');
      throw error;
    }
  }

  /**
   * Fetches all validators from the API
   */
  private async getValidators(): Promise<ValidatorResponse['validators']> {
    if (!this.client) throw new Error('BabylonClient not initialized');
    
    try {
      const validators: ValidatorResponse['validators'] = [];
      let nextKey: string | null = null;
      
      // Fetch all pages
      do {
        const params: Record<string, any> = { 'pagination.limit': 100 };
        
        if (nextKey) {
          params['pagination.key'] = nextKey;
        }
        
        const response = await this.client.makeRestRequest<ValidatorResponse>(
          '/cosmos/staking/v1beta1/validators',
          params
        );
        
        validators.push(...response.validators);
        nextKey = response.pagination.next_key;
      } while (nextKey);
      
      return validators;
    } catch (error) {
      logger.error({ error }, 'Error getting validators');
      throw error;
    }
  }

  /**
   * Schedules periodic updates
   */
  private schedulePeriodidUpdate(): void {
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
    }
    
    this.updateTimer = setInterval(async () => {
      try {
        logger.info(`Validator information is updating for ${this.getNetwork()}...`);
        await this.loadValidatorsFromAPI();
        logger.info(`Validator information updated successfully for ${this.getNetwork()}`);
      } catch (error) {
        logger.error({ error }, `Error updating validator information (${this.getNetwork()})`);
      }
    }, this.UPDATE_INTERVAL);
    
    logger.info(`Validator information will be updated every ${this.UPDATE_INTERVAL / (60 * 1000)} minutes`);
  }
  
  /**
   * Creates a consensus address from the consensus pubkey
   * @param pubkey Consensus pubkey
   */
  private pubkeyToConsAddress(pubkey: string): string {
    try {
      // This method converts the pubkey to a consensus address
      // The actual implementation may vary depending on your project's needs
      
      // Example: Simple base64 decode and hash operation
      // In a real project, cosmjs or a similar library can be used
      return addressConverter.pubkeyToConsAddress(pubkey);
    } catch (error) {
      logger.error({ error, pubkey }, 'Error converting pubkey to consensus address');
      throw error;
    }
  }
  
  /**
   * Calculates voting power from the token amount
   * @param tokens Token amount
   */
  private calculateVotingPower(tokens: string): string {
    // Example: Divides tokens by a certain factor
    // Babylon's specific calculation method can be used
    try {
      const tokenAmount = BigInt(tokens);
      // Example: 1 UBBN = 10^6 conversion
      const votingPower = tokenAmount / BigInt(1000000);
      return votingPower.toString();
    } catch (error) {
      logger.warn({ error, tokens }, 'Error calculating voting power, using token value');
      return tokens;
    }
  }
  
  /**
   * Gets validator information from the database by ID
   * @param id Validator ID
   */
  async getValidatorById(id: ObjectId): Promise<ValidatorInfo | null> {
    try {
      // The query from the database can be done directly or a repository can be used
      // This example shows direct repository usage
      const validators = await validatorInfoRepository.getAllValidators(this.getNetwork());
      return validators.find(v => v._id.equals(id)) || null;
    } catch (error) {
      logger.error({ error, id }, 'Error getting validator by ID');
      throw error;
    }
  }
  
  /**
   * Gets validator information by any address format
   * @param address Address in any format
   */
  async getValidatorByAnyAddress(address: string): Promise<ValidatorInfo | null> {
    try {
      // Check cache (map) first
      if (this.validatorInfoMap.has(address)) {
        return this.validatorInfoMap.get(address)!;
      }
      
      // Search in database
      return validatorInfoRepository.findByAnyAddress(address, this.getNetwork());
    } catch (error) {
      logger.error({ error, address }, 'Error searching for validator by any address');
      throw error;
    }
  }
  
  /**
   * Returns the validator list
   * @param limit Maximum number of results
   */
  async getAllValidators(limit: number = 1000): Promise<ValidatorInfo[]> {
    try {
      // If the cache (map) is full and below the limit, return from the cache
      if (this.validatorInfoMap.size > 0 && this.validatorInfoMap.size <= limit) {
        return Array.from(this.validatorInfoMap.values());
      }
      
      // Get from database
      return validatorInfoRepository.getAllValidators(this.getNetwork(), limit);
    } catch (error) {
      logger.error({ error }, 'Error getting all validators');
      throw error;
    }
  }
  
  /**
   * Checks if the service is active
   */
  public isEnabled(): boolean {
    return this.options !== null && this.options.enabled === true;
  }
  
  /**
   * Returns the network
   */
  public getNetwork(): Network {
    return this.options?.network || Network.MAINNET;
  }

  /**
   * A new block is processed (for MonitoringService interface)
   * @param height Block height
   */
  async handleNewBlock(height: number): Promise<void> {
    // Block-based processing is not required for this service
    // Validator information is updated periodically
    return;
  }
  
  /**
   * Returns the service name (for MonitoringService interface)
   */
  getName(): string {
    return `ValidatorInfoService-${this.getNetwork()}`;
  }
}

// Singleton instance
const validatorInfoService = new ValidatorInfoService();
export default validatorInfoService;