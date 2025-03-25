import { BabylonClient } from '../../clients/babylon-client.interface';
import logger from '../../utils/logger';
import { ActiveFinalityProvider, EpochInfo, FinalityProviderResponse, VoteResponse } from './types';

/**
 * Class managing API calls related to Finality Providers
 */
export class FinalityProviderApiClient {
  constructor(private readonly client: BabylonClient) {
    if (!client) {
      throw new Error('BabylonClient not initialized');
    }
  }

  /**
   * Retrieves votes at a specific height
   */
  async getVotesAtHeight(height: number): Promise<VoteResponse> {
    try {
      const response = await this.client.makeRestRequest<VoteResponse>(
        `/babylon/finality/v1/votes/${height}`
      );
      return response;
    } catch (error) {
      logger.error({ error, height }, 'Error retrieving finality provider votes');
      throw error;
    }
  }

  /**
   * Retrieves all finality providers
   */
  async getFinalityProviders(): Promise<FinalityProviderResponse['finality_providers']> {
    try {
      const response = await this.client.makeRestRequest<FinalityProviderResponse>(
        '/babylon/btcstaking/v1/finality_providers',
        { 'pagination.limit': 1000 }
      );
      return response.finality_providers;
    } catch (error) {
      logger.error({ error }, 'Error retrieving finality providers');
      throw error;
    }
  }

  /**
   * Retrieves active finality providers at a specific height
   */
  async getActiveFinalityProviders(height: number): Promise<ActiveFinalityProvider[]> {
    try {
      const response = await this.client.makeRestRequest<{
        finality_providers: ActiveFinalityProvider[]
      }>(`/babylon/finality/v1/finality_providers/${height}`);
      
      return response.finality_providers;
    } catch (error) {
      logger.error({ error, height }, 'Error retrieving active finality provider list');
      throw error;
    }
  }

  /**
   * Retrieves current epoch information
   */
  async getCurrentEpochInfo(): Promise<EpochInfo> {
    try {
      const response = await this.client.makeRestRequest<{ current_epoch: string, epoch_boundary: string }>(
        '/babylon/epoching/v1/current_epoch'
      );
      
      const currentEpoch = parseInt(response.current_epoch);
      const epochBoundary = parseInt(response.epoch_boundary);
      
      if (isNaN(currentEpoch)) {
        logger.warn(`Epoch value is not a number: ${response.current_epoch}`);
      }
      
      return {
        currentEpoch: isNaN(currentEpoch) ? 0 : currentEpoch,
        epochBoundary: isNaN(epochBoundary) ? 0 : epochBoundary
      };
    } catch (error) {
      logger.error({ error }, 'Error retrieving current epoch information');
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