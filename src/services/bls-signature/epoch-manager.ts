import logger from '../../utils/logger';
import { BLSApiClient } from './api-client';
import { ServiceConstants } from './types';

/**
 * Class for managing epoch information for BLS signatures
 */
export class EpochManager {
  private currentEpoch = 0;
  private epochCheckpoints: Set<number> = new Set(); // Processed checkpoints

  constructor(
    private readonly apiClient: BLSApiClient,
    private readonly constants: ServiceConstants
  ) {}

  /**
   * Fetches the current epoch from the API
   */
  async fetchCurrentEpoch(): Promise<void> {
    try {
      const response = await this.apiClient.getCurrentEpoch();
      
      // Use the current_epoch field
      const newEpoch = parseInt(response.current_epoch);
      
      if (!isNaN(newEpoch) && newEpoch !== this.currentEpoch) {
        logger.info(`New epoch: ${newEpoch}, previous: ${this.currentEpoch}`);
        this.currentEpoch = newEpoch;
      } else if (isNaN(newEpoch)) {
        logger.warn(`Epoch value is not a number: ${response.current_epoch}`);
      }
    } catch (error) {
      logger.error({ error }, 'Error getting current epoch information');
      throw error;
    }
  }

  /**
   * Calculates the target block height for a checkpoint in a specific epoch
   */
  calculateCheckpointHeight(epochNum: number): number {
    const epochLength = this.constants.EPOCH_BLOCKS;
    const epochBoundary = epochNum * epochLength;
    return epochBoundary + 1; // Checkpoint is usually at the end of the epoch + 1 block
  }

  /**
   * Returns the current epoch
   */
  getCurrentEpoch(): number {
    return this.currentEpoch;
  }

  /**
   * Marks an epoch as processed
   */
  markEpochProcessed(epochNum: number): void {
    this.epochCheckpoints.add(epochNum);
  }

  /**
   * Checks if an epoch has been processed
   */
  isEpochProcessed(epochNum: number): boolean {
    return this.epochCheckpoints.has(epochNum);
  }

  /**
   * Returns a list of all processed epochs
   */
  getProcessedEpochs(): number[] {
    return Array.from(this.epochCheckpoints);
  }

  /**
   * Clears the processed epochs list
   */
  clearProcessedEpochs(): void {
    this.epochCheckpoints.clear();
  }
} 