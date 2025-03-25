import { BabylonClient } from '../../clients/babylon-client.interface';
import logger from '../../utils/logger';
import { BlockData } from './types';

/**
 * Class managing API calls related to Validator Signatures
 */
export class ValidatorApiClient {
  constructor(private readonly client: BabylonClient) {
    if (!client) {
      throw new Error('BabylonClient not initialized');
    }
  }

  /**
   * Retrieves block data at a specific height
   */
  async getBlockAtHeight(height: number): Promise<BlockData> {
    try {
      const response = await this.client.makeRestRequest<BlockData>(
        `/cosmos/base/tendermint/v1beta1/blocks/${height}`
      );
      return response;
    } catch (error) {
      logger.error({ error, height }, 'Error retrieving block data');
      throw error;
    }
  }

  /**
   * Retrieves all validators with jailed status
   */
  async getAllValidators(): Promise<any[]> {
    try {
      const response = await this.client.makeRestRequest<any>(
        '/cosmos/staking/v1beta1/validators',
        { 'pagination.limit': 1000 }
      );
      
      return response.validators || [];
    } catch (error) {
      logger.error({ error }, 'Error retrieving validators');
      throw error;
    }
  }

  /**
   * Retrieves active validators (BOND_STATUS_BONDED)
   */
  async getActiveValidators(): Promise<any[]> {
    try {
      const validators = await this.getAllValidators();
      return validators.filter(v => v.status === 'BOND_STATUS_BONDED');
    } catch (error) {
      logger.error({ error }, 'Error retrieving active validators');
      throw error;
    }
  }

  /**
   * Retrieves jailed validators
   */
  async getJailedValidators(): Promise<any[]> {
    try {
      const validators = await this.getAllValidators();
      return validators.filter(v => v.jailed === true);
    } catch (error) {
      logger.error({ error }, 'Error retrieving jailed validators');
      throw error;
    }
  }

  /**
   * Retrieves current block height
   */
  async getCurrentHeight(): Promise<number> {
    return this.client.getCurrentHeight();
  }
} 