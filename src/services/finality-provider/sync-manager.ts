import logger from '../../utils/logger';
import { ServiceConstants, SyncStatus } from './types';
import { Network } from '../../config/config';
import { FinalityProviderApiClient } from './api-client';
import finalityProviderSignatureRepository from '../../database/repositories/finality-provider-signature.repository';

/**
 * Service that manages the Finality Provider synchronization
 */
export class SyncManager {
  private syncStatus: SyncStatus = {
    lastProcessedHeight: 0,
    isInitialSyncComplete: false
  };
  
  constructor(
    private readonly apiClient: FinalityProviderApiClient,
    private readonly constants: ServiceConstants,
    private readonly network: Network,
    private readonly onBlockProcessed: (height: number) => Promise<void>
  ) {}

  /**
   * Performs initial synchronization
   */
  async performInitialSync(): Promise<void> {
    if (this.syncStatus.isInitialSyncComplete) {
      logger.debug(`Initial sync already completed (${this.network})`);
      return;
    }

    try {
      // Get current block height
      const currentHeight = await this.apiClient.getCurrentHeight();
      
      // Last finalized block (3 blocks behind for safe processing)
      const finalizedHeight = currentHeight - this.constants.FINALIZED_BLOCKS_WAIT;
      
      // Find last processed block from the database
      const lastSyncedBlock = await this.findLastSyncedBlock();
      
      // Calculate synchronization range
      const syncStartHeight = lastSyncedBlock > 0 ? lastSyncedBlock + 1 : finalizedHeight - this.constants.MAX_SYNC_BLOCKS;
      const syncEndHeight = finalizedHeight;
      
      // If there are no blocks to synchronize, exit
      if (syncStartHeight >= syncEndHeight) {
        logger.info(`No blocks to sync. Last processed block: ${lastSyncedBlock}, current block: ${currentHeight} (${this.network})`);
        this.syncStatus.lastProcessedHeight = finalizedHeight;
        this.syncStatus.isInitialSyncComplete = true;
        return;
      }
      
      // Calculate the number of blocks to synchronize
      const blockCount = syncEndHeight - syncStartHeight + 1;
      
      // Limit the synchronization range
      const limitedEndHeight = blockCount > this.constants.MAX_SYNC_BLOCKS 
                               ? syncStartHeight + this.constants.MAX_SYNC_BLOCKS - 1
                               : syncEndHeight;
      
      logger.info(`Starting initial sync: ${syncStartHeight} - ${limitedEndHeight} (${limitedEndHeight - syncStartHeight + 1} blocks) (${this.network})`);
      
      // Synchronize blocks
      for (let height = syncStartHeight; height <= limitedEndHeight; height++) {
        await this.onBlockProcessed(height);
        this.syncStatus.lastProcessedHeight = height;
        
        // Log every 20 blocks
        if (height % 20 === 0 || height === limitedEndHeight) {
          const progress = Math.floor(((height - syncStartHeight + 1) / (limitedEndHeight - syncStartHeight + 1)) * 100);
          logger.info(`Sync progress: %${progress} (${height - syncStartHeight + 1}/${limitedEndHeight - syncStartHeight + 1} blocks) (${this.network})`);
        }
      }
      
      // Synchronization completed
      this.syncStatus.isInitialSyncComplete = true;
      logger.info(`Initial sync completed: ${syncStartHeight} - ${limitedEndHeight} (${limitedEndHeight - syncStartHeight + 1} blocks) (${this.network})`);
    } catch (error) {
      logger.error({ error }, `Error during initial sync (${this.network})`);
      throw error;
    }
  }

  /**
   * Finds the last processed block from the database
   */
  private async findLastSyncedBlock(): Promise<number> {
    try {
      const lastSignature = await finalityProviderSignatureRepository.getLastProcessedHeight(this.network);
      return lastSignature || 0;
    } catch (error) {
      logger.error({ error }, `Error finding last processed block (${this.network})`);
      return 0;
    }
  }

  /**
   * Returns the synchronization status
   */
  getSyncStatus(): SyncStatus {
    return this.syncStatus;
  }
}