import logger from '../../utils/logger';
import { BlockVotes, ServiceConstants } from './types';

/**
 * Class managing the cache for validator signatures
 */
export class CacheManager {
  private blockVotesCache: Map<number, BlockVotes> = new Map();

  constructor(private readonly constants: ServiceConstants) {}

  /**
   * Caches the vote data at a specific height
   */
  cacheVotes(height: number, signers: Set<string>, timestamp: Date, round: number): void {
    // Remove old entries if cache is too large
    if (this.blockVotesCache.size >= this.constants.MAX_CACHE_SIZE) {
      // Find the oldest height
      const heights = Array.from(this.blockVotesCache.keys()).sort((a, b) => a - b);
      // Remove the oldest entry
      if (heights.length > 0) {
        this.blockVotesCache.delete(heights[0]);
      }
    }

    // Add new entry
    this.blockVotesCache.set(height, {
      height,
      signers,
      timestamp,
      round
    });
  }

  /**
   * Returns the votes at a specific height from the cache
   */
  getVotes(height: number): BlockVotes | null {
    return this.blockVotesCache.get(height) || null;
  }

  /**
   * Checks if votes at a specific height are in the cache
   */
  hasVotes(height: number): boolean {
    return this.blockVotesCache.has(height);
  }

  /**
   * Clears the cache
   */
  clearCache(): void {
    this.blockVotesCache.clear();
    logger.debug('Validator signature cache cleared');
  }

  /**
   * Returns the size of the cache
   */
  getCacheSize(): number {
    return this.blockVotesCache.size;
  }
} 