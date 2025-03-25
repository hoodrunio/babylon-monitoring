import logger from '../../utils/logger';
import { Network } from '../../config/config';
import { ValidatorResponse } from './types';
import { ValidatorInfo } from '../../models/validator-info.model';
import { AddressConverter } from './address-converter';
import validatorInfoRepository from '../../database/repositories/validator-info.repository';

/**
 * Class for processing validator information
 */
export class ValidatorProcessor {
  private validatorInfoMap: Map<string, ValidatorInfo> = new Map();
  
  constructor(
    private readonly addressConverter: AddressConverter,
    private readonly network: Network
  ) {}

  /**
   * Processes validators from API response and saves to database
   */
  async processValidators(validators: ValidatorResponse['validators']): Promise<void> {
    try {
      logger.info(`Processing ${validators.length} validators for ${this.network} network`);
      
      // Clear validator info map first
      this.validatorInfoMap.clear();
      
      // For each validator
      for (const validator of validators) {
        try {
          // Create validator information
          const validatorInfo = await this.createValidatorInfo(validator);
          
          // Save to database
          await validatorInfoRepository.saveValidator(validatorInfo);
          
          // Add to validator info map
          this.validatorInfoMap.set(validatorInfo.validator_address, validatorInfo);
          
          // Also add by operator address for faster lookup
          this.validatorInfoMap.set(validatorInfo.operator_address, validatorInfo);
          
          // Add by hex address
          this.validatorInfoMap.set(validatorInfo.validator_hex_address, validatorInfo);
          
          logger.debug({ 
            validator_address: validatorInfo.validator_address, 
            hex_address: validatorInfo.validator_hex_address,
            operator_address: validatorInfo.operator_address,
            moniker: validatorInfo.moniker
          }, 'Validator information processed');
        } catch (error) {
          logger.error({ 
            error, 
            operator_address: validator.operator_address,
            moniker: validator.description.moniker 
          }, 'Error processing validator');
        }
      }
      
      logger.info(`${this.validatorInfoMap.size} validator entries added to cache for ${this.network}`);
    } catch (error) {
      logger.error({ error, network: this.network }, 'Error processing validators');
      throw error;
    }
  }

  /**
   * Creates validator information from API validator data
   */
  private async createValidatorInfo(validator: ValidatorResponse['validators'][0]): Promise<ValidatorInfo> {
    // Create consensus address
    const consensusPubkey = validator.consensus_pubkey.key;
    const consensusAddress = this.addressConverter.pubkeyToConsAddress(consensusPubkey);
    
    // Create hex address
    const hexAddress = await this.addressConverter.bech32ToHex(consensusAddress);
    
    // Calculate voting power
    const votingPower = this.calculateVotingPower(validator.tokens);
    
    // Create validator information
    const validatorInfo: ValidatorInfo = {
      validator_address: consensusAddress,
      validator_hex_address: hexAddress,
      operator_address: validator.operator_address,
      consensus_pubkey: validator.consensus_pubkey,
      moniker: validator.description.moniker,
      description: validator.description,
      tokens: validator.tokens,
      voting_power: votingPower,
      commission: {
        rate: validator.commission.commission_rates.rate,
        max_rate: validator.commission.commission_rates.max_rate,
        max_change_rate: validator.commission.commission_rates.max_change_rate
      },
      status: validator.status,
      network: this.network,
      alternative_addresses: {
        bech32: [consensusAddress],
        hex: [hexAddress]
      },
      last_updated: new Date()
    };
    
    return validatorInfo;
  }

  /**
   * Calculates voting power from token amount
   */
  private calculateVotingPower(tokens: string): string {
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
   * Gets the validator map
   */
  getValidatorInfoMap(): Map<string, ValidatorInfo> {
    return this.validatorInfoMap;
  }

  /**
   * Gets validator information by address
   */
  getValidatorByAddress(address: string): ValidatorInfo | undefined {
    return this.validatorInfoMap.get(address);
  }

  /**
   * Checks if validator info map is empty
   */
  isValidatorMapEmpty(): boolean {
    return this.validatorInfoMap.size === 0;
  }

  /**
   * Gets the number of validators in the map
   */
  getValidatorCount(): number {
    return this.validatorInfoMap.size;
  }
} 