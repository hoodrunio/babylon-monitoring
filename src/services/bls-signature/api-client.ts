import { BabylonClient } from '../../clients/babylon-client.interface';
import logger from '../../utils/logger';
import { BlockTransactionsResponse, EpochResponse, ValidatorResponse } from './types';

/**
 * Class managing API calls related to BLS signatures and checkpoints
 */
export class BLSApiClient {
  constructor(private readonly client: BabylonClient) {
    if (!client) {
      throw new Error('BabylonClient not initialized');
    }
  }

  /**
   * Retrieves current epoch information
   */
  async getCurrentEpoch(): Promise<EpochResponse> {
    try {
      return await this.client.makeRestRequest<EpochResponse>(
        '/babylon/epoching/v1/current_epoch'
      );
    } catch (error) {
      logger.error({ error }, 'Error retrieving current epoch information');
      throw error;
    }
  }

  /**
   * Retrieves transactions at a specific height
   */
  async getTransactionsAtHeight(height: number): Promise<BlockTransactionsResponse> {
    try {
      return await this.client.makeRestRequest<BlockTransactionsResponse>(
        `/cosmos/tx/v1beta1/txs/block/${height}`
      );
    } catch (error) {
      logger.error({ error, height }, 'Error retrieving block transactions');
      throw error;
    }
  }

  /**
   * Retrieves all validators
   */
  async getAllValidators(): Promise<ValidatorResponse['validators']> {
    try {
      const response = await this.client.makeRestRequest<ValidatorResponse>(
        '/cosmos/staking/v1beta1/validators',
        { 'pagination.limit': 1000 }
      );
      return response.validators;
    } catch (error) {
      logger.error({ error }, 'Error retrieving validators');
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