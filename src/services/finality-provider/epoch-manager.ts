import { ServiceConstants } from './types';
import logger from '../../utils/logger';
import { FinalityProviderApiClient } from './api-client';

/**
 * Service for tracking and managing epochs
 */
export class EpochManager {
  private currentEpoch = 0;
  private lastCheckedEpoch = 0;
  private currentEpochBoundary = 0;

  constructor(
    private readonly apiClient: FinalityProviderApiClient,
    private readonly constants: ServiceConstants
  ) {}

  /**
   * Fetches the current epoch information
   */
  async fetchCurrentEpoch(): Promise<void> {
    try {
      const epochInfo = await this.apiClient.getCurrentEpochInfo();

      const newEpoch = epochInfo.currentEpoch;
      const epochBoundary = epochInfo.epochBoundary;

      if (newEpoch !== this.currentEpoch) {
        logger.info(`New epoch: ${newEpoch}, previous: ${this.currentEpoch}, ending block: ${epochBoundary}`);
        this.currentEpoch = newEpoch;

        if (epochBoundary > 0) {
          this.currentEpochBoundary = epochBoundary;
          logger.info(`Current epoch boundary: ${this.currentEpochBoundary}`);
        } else if (this.currentEpoch > 0) {
          // Calculate epoch boundary if it cannot be retrieved from the API
          this.currentEpochBoundary = this.currentEpoch * this.constants.EPOCH_BLOCKS;
          logger.info(`Epoch boundary calculated: ${this.currentEpochBoundary}`);
        }
      }

      // Log if epoch boundary has changed
      if (epochBoundary > 0 && this.currentEpochBoundary !== epochBoundary) {
        logger.info(`Epoch boundary updated: ${epochBoundary}, previous: ${this.currentEpochBoundary}`);
        this.currentEpochBoundary = epochBoundary;
      }
    } catch (error) {
      logger.error({ error }, 'Error fetching current epoch information');
    }
  }

  /**
   * Checks if epoch needs to be updated
   */
  shouldUpdateEpoch(height: number): boolean {
    return height % 50 === 0; // Check every 50 blocks
  }

  /**
   * Checks if finality providers need to be updated
   */
  shouldUpdateFinalityProviders(height: number): boolean {
    return (this.currentEpochBoundary > 0 && height >= this.currentEpochBoundary) ||
           (this.currentEpoch > this.lastCheckedEpoch);
  }

  /**
   * Updates if a new epoch has started
   */
  updateLastCheckedEpoch(): void {
    this.lastCheckedEpoch = this.currentEpoch;
  }

  /**
   * Updates the epoch boundary
   */
  updateEpochBoundary(height: number): void {
    if (height >= this.currentEpochBoundary) {
      this.currentEpochBoundary += this.constants.EPOCH_BLOCKS;
      logger.info(`Epoch boundary updated: ${this.currentEpochBoundary}`);
    }
  }

  /**
   * Returns the current epoch information
   */
  getCurrentEpoch(): number {
    return this.currentEpoch;
  }

  /**
   * Returns the current epoch boundary
   */
  getCurrentEpochBoundary(): number {
    return this.currentEpochBoundary;
  }
}