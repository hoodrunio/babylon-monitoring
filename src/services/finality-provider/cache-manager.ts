import logger from '../../utils/logger';
import { ServiceConstants } from './types';

/**
 * Cache management for the Finality Provider service
 */
export class CacheManager {
  private votesCache: Map<number, Set<string>> = new Map();
  private processedBlocks: Set<number> = new Set();
  
  constructor(private readonly constants: ServiceConstants) {}

  /**
   * Caches votes at a specific height
   */
  cacheVotes(height: number, signers: Set<string>): void {
    this.votesCache.set(height, signers);
    this.cleanupVotesCache();
  }

  /**
   * Gets votes from cache for a specific height
   */
  getVotes(height: number): Set<string> | undefined {
    return this.votesCache.get(height);
  }

  /**
   * Checks if a block has been processed
   */
  isBlockProcessed(height: number): boolean {
    return this.processedBlocks.has(height);
  }

  /**
   * Marks a specific block as processed
   */
  markBlockAsProcessed(height: number): void {
    this.processedBlocks.add(height);
    
    if (this.processedBlocks.size > this.constants.MAX_CACHE_SIZE) {
      this.cleanupProcessedBlocks();
    }
  }

  /**
   * Cleans up processed blocks cache
   */
  private cleanupProcessedBlocks(): void {
    if (this.processedBlocks.size > this.constants.MAX_CACHE_SIZE) {
      const sortedBlocks = Array.from(this.processedBlocks).sort((a, b) => a - b);
      const deleteCount = sortedBlocks.length - Math.floor(this.constants.MAX_CACHE_SIZE / 2);
      
      for (let i = 0; i < deleteCount; i++) {
        this.processedBlocks.delete(sortedBlocks[i]);
      }
      
      logger.debug(`${deleteCount} old processed blocks cleared from cache`);
    }
  }

  /**
   * Cleans up votes cache
   */
  private cleanupVotesCache(): void {
    if (this.votesCache.size > this.constants.MAX_CACHE_SIZE) {
      const heights = Array.from(this.votesCache.keys()).sort((a, b) => a - b);
      const deleteCount = this.votesCache.size - Math.floor(this.constants.MAX_CACHE_SIZE / 2);
      
      for (let i = 0; i < deleteCount; i++) {
        if (heights[i] !== undefined) {
          this.votesCache.delete(heights[i]);
        }
      }
      
      logger.debug(`${deleteCount} old votes cleared from cache`);
    }
  }

  /**
   * Clears all caches
   */
  clearAll(): void {
    this.votesCache.clear();
    this.processedBlocks.clear();
  }
}