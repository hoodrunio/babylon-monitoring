import logger from '../../utils/logger';
import { Network } from '../../config/config';
import validatorInfoService from '../validator-info-service';
import { ValidatorInfo } from '../../models/validator-info.model';

/**
 * Class for managing validator information
 */
export class ValidatorManager {
  private validatorCache: Map<string, ValidatorInfo> = new Map();
  
  constructor(
    private readonly network: Network
  ) {}

  /**
   * Loads all validator information
   */
  async loadValidatorInfo(): Promise<void> {
    try {
      // Get all validators
      const validators = await validatorInfoService.getAllValidators();

      // Add to cache
      for (const validator of validators) {
        // Add to cache from main address
        this.validatorCache.set(validator.operator_address, validator);

        // Add to cache from alternative addresses
        if (validator.alternative_addresses) {
          if (validator.alternative_addresses.bech32) {
            for (const bech32Address of validator.alternative_addresses.bech32) {
              this.validatorCache.set(bech32Address, validator);
            }
          }
          if (validator.alternative_addresses.hex) {
            for (const hexAddress of validator.alternative_addresses.hex) {
              this.validatorCache.set(hexAddress, validator);
            }
          }
        }
      }

      logger.info(`${validators.length} validator information loaded (${this.network})`);
    } catch (error) {
      logger.error({ error, network: this.network }, 'Error loading validator information');
    }
  }

  /**
   * Gets validator information by any address
   */
  async getValidatorInfo(address: string): Promise<ValidatorInfo | null> {
    // Check the cache first
    const cachedInfo = this.validatorCache.get(address);
    if (cachedInfo) return cachedInfo;

    // Get from service if not in cache
    try {
      const validatorInfo = await validatorInfoService.getValidatorByAnyAddress(address);

      // Add to cache if information is found
      if (validatorInfo) {
        this.validatorCache.set(address, validatorInfo);

        // Add to cache with alternative addresses as well
        if (validatorInfo.alternative_addresses) {
          if (validatorInfo.alternative_addresses.bech32) {
            for (const bech32Address of validatorInfo.alternative_addresses.bech32) {
              this.validatorCache.set(bech32Address, validatorInfo);
            }
          }
          if (validatorInfo.alternative_addresses.hex) {
            for (const hexAddress of validatorInfo.alternative_addresses.hex) {
              this.validatorCache.set(hexAddress, validatorInfo);
            }
          }
        }
      }

      return validatorInfo;
    } catch (error) {
      logger.error({ error, address }, 'Error getting validator information');
      return null;
    }
  }

  /**
   * Gets all validators
   */
  async getAllValidators(): Promise<ValidatorInfo[]> {
    const validators = await validatorInfoService.getAllValidators();
    return validators;
  }

  /**
   * Returns the size of the validator cache
   */
  getCacheSize(): number {
    return this.validatorCache.size;
  }

  /**
   * Clears the validator cache
   */
  clearCache(): void {
    this.validatorCache.clear();
    logger.debug('Validator cache cleared');
  }
} 