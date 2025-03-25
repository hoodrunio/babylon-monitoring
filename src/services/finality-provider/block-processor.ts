import logger from '../../utils/logger';
import { BlockToProcess, ServiceConstants } from './types';
import { Network } from '../../config/config';
import { FinalityProviderApiClient } from './api-client';
import { CacheManager } from './cache-manager';

/**
 * Service processing Finality Provider blocks
 */
export class BlockProcessor {
  private blockQueue: BlockToProcess[] = [];
  private isProcessingQueue = false;
  private lastProcessedHeight = 0;
  
  constructor(
    private readonly apiClient: FinalityProviderApiClient,
    private readonly cacheManager: CacheManager,
    private readonly constants: ServiceConstants,
    private readonly network: Network,
    private readonly onBlockProcessed: (height: number, signers: Set<string>) => Promise<void>
  ) {}

  /**
   * Adds a new block to the queue
   */
  addBlockToQueue(height: number): void {
    if (height <= this.lastProcessedHeight) {
      return; // Already processed block
    }
    
    // Update the last processed block height
    this.lastProcessedHeight = Math.max(this.lastProcessedHeight, height);
    
    // If the block has already been processed, do not add it to the queue
    if (this.cacheManager.isBlockProcessed(height)) {
      return;
    }
    
    // Add the block to the queue
    this.blockQueue.push({
      height,
      timestamp: new Date()
    });
    
    // Sort from smallest height to largest
    this.blockQueue.sort((a, b) => a.height - b.height);
    
    logger.debug(`Block #${height} added to queue. Queue size: ${this.blockQueue.length}`);
  }

  /**
   * Processes the block queue
   */
  async processBlockQueue(): Promise<void> {
    // Exit if the queue is already being processed
    if (this.isProcessingQueue) {
      return;
    }
    
    this.isProcessingQueue = true;
    
    try {
      while (this.blockQueue.length > 0) {
        // Get the first block in the queue
        const currentBlock = this.blockQueue[0];
        const currentHeight = currentBlock.height;
        
        // Wait if there are not enough blocks to finalize
        if (currentHeight + this.constants.FINALIZED_BLOCKS_WAIT > this.lastProcessedHeight) {
          logger.debug(`Block #${currentHeight} waiting to be finalized. Last processed block: ${this.lastProcessedHeight}`);
          break;
        }
        
        // Process votes for this block
        await this.processBlockVotes(currentHeight);
        
        // Remove the processed block from the queue
        this.blockQueue.shift();
        
        // Add the processed block to the tracking set
        this.cacheManager.markBlockAsProcessed(currentHeight);
      }
    } catch (error) {
      logger.error({ error }, 'Error processing block queue');
    } finally {
      this.isProcessingQueue = false;
    }
  }

  /**
   * Processes votes for a specific block height
   */
  private async processBlockVotes(height: number): Promise<void> {
    try {
      logger.info(`Processing finality provider votes for block #${height}`);
      
      // Get finality provider votes
      const votes = await this.apiClient.getVotesAtHeight(height);
      if (!votes || !votes.btc_pks || votes.btc_pks.length === 0) {
        logger.warn({ height }, 'Finality provider votes not found');
        return;
      }

      // Process votes
      const signers = new Set(votes.btc_pks); // Voters
      this.cacheManager.cacheVotes(height, signers);
      
      // Call callback function
      await this.onBlockProcessed(height, signers);
      
      logger.info(`Finality provider votes processed for block #${height}, number of signing providers: ${votes.btc_pks.length}`);
    } catch (error) {
      logger.error({ error, height }, 'Error processing finality provider votes');
    }
  }
}