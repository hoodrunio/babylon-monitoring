import { BabylonClient } from '../../clients/babylon-client.interface';
import logger from '../../utils/logger';
import { ValidatorResponse } from './types';

/**
 * Class managing API calls related to Validator Info
 */
export class ValidatorInfoApiClient {
  constructor(private readonly client: BabylonClient) {
    if (!client) {
      throw new Error('BabylonClient not initialized');
    }
  }

  /**
   * Fetches validators from the API
   * @param pageKey Pagination key
   * @param pageLimit Page size limit
   */
  async getValidators(pageKey?: string, pageLimit: number = 100): Promise<ValidatorResponse> {
    try {
      const params: Record<string, any> = { 'pagination.limit': pageLimit };
      
      if (pageKey) {
        params['pagination.key'] = pageKey;
      }
      
      return await this.client.makeRestRequest<ValidatorResponse>(
        '/cosmos/staking/v1beta1/validators',
        params
      );
    } catch (error) {
      logger.error({ error, pageKey, pageLimit }, 'Error retrieving validators');
      throw error;
    }
  }

  /**
   * Fetches all validators from the API by iterating through pagination
   */
  async getAllValidators(): Promise<ValidatorResponse['validators']> {
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
      logger.error({ error }, 'Error getting all validators');
      throw error;
    }
  }

  /**
   * Retrieves a specific validator by operator_address
   */
  async getValidatorByOperatorAddress(operatorAddress: string): Promise<ValidatorResponse['validators'][0] | null> {
    try {
      const response = await this.client.makeRestRequest<ValidatorResponse>(
        `/cosmos/staking/v1beta1/validators/${operatorAddress}`
      );
      
      if (response && response.validators && response.validators.length > 0) {
        return response.validators[0];
      }
      
      return null;
    } catch (error) {
      logger.error({ error, operatorAddress }, 'Error retrieving validator by operator address');
      return null;
    }
  }

  /**
   * Retrieves current block height
   */
  async getCurrentHeight(): Promise<number> {
    return this.client.getCurrentHeight();
  }
} 