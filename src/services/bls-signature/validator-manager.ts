import logger from '../../utils/logger';
import { BLSApiClient } from './api-client';
import { CheckpointValidator } from './types';

/**
 * Class for managing validator information for BLS signatures
 */
export class ValidatorManager {
  private validatorInfoMap: Map<string, CheckpointValidator> = new Map();

  constructor(private readonly apiClient: BLSApiClient) {}

  /**
   * Loads all validator information
   */
  async loadValidatorInfo(): Promise<void> {
    try {
      const validators = await this.apiClient.getAllValidators();
      
      this.validatorInfoMap.clear();
      
      for (const validator of validators) {
        const consensusKey = validator.consensus_pubkey.key;
        const validatorAddress = this.pubkeyToAddress(consensusKey);
        
        this.validatorInfoMap.set(validatorAddress, {
          moniker: validator.description.moniker,
          operatorAddress: validator.operator_address,
          power: validator.voting_power
        });
      }
      
      logger.info(`${validators.length} validators loaded for BLS signature monitoring`);
    } catch (error) {
      logger.error({ error }, 'Error loading validator information');
      throw error;
    }
  }

  /**
   * Gets validator information by address
   */
  getValidatorInfo(address: string): CheckpointValidator | undefined {
    return this.validatorInfoMap.get(address);
  }

  /**
   * Checks if a validator exists
   */
  hasValidator(address: string): boolean {
    return this.validatorInfoMap.has(address);
  }

  /**
   * Converts a public key to an address
   * This is a simplified implementation
   */
  private pubkeyToAddress(pubkey: string): string {
    // This is an example implementation. In a real application, hash and encoding operations are required
    // to obtain the address from the consensus pubkey.
    return pubkey;
  }

  /**
   * Returns the number of validators
   */
  getValidatorCount(): number {
    return this.validatorInfoMap.size;
  }

  /**
   * Returns the validator map
   */
  getValidatorMap(): Map<string, CheckpointValidator> {
    return this.validatorInfoMap;
  }
} 