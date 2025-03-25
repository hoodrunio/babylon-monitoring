import logger from '../../utils/logger';
import { Network } from '../../config/config';
import { MonitoringServiceOptions } from '../monitoring-service.interface';
import { ValidatorBlockInfo, ServiceConstants } from './types';
import { ValidatorSignatureStats } from '../../models/validator-signature.model';
import validatorSignatureRepository from '../../database/repositories/validator-signature.repository';
import { ValidatorInfo } from '../../models/validator-info.model';
import { NotificationService } from './notification-service';

/**
 * Class for managing validator signature statistics
 */
export class StatsManager {
  private validatorStatsCache: Map<string, ValidatorSignatureStats> = new Map();
  
  constructor(
    private readonly network: Network,
    private readonly options: MonitoringServiceOptions,
    private readonly notificationService: NotificationService,
    private readonly constants: ServiceConstants
  ) {}

  /**
   * Updates validator signature statistics
   */
  async updateValidatorSignature(
    validatorInfo: ValidatorInfo,
    blockHeight: number,
    timestamp: Date,
    round: number,
    signed: boolean
  ): Promise<void> {
    try {
      // Validator info check
      if (!validatorInfo || !validatorInfo.operator_address) {
        logger.warn({
          blockHeight,
          validatorInfo: validatorInfo ? validatorInfo.moniker : 'undefined'
        }, 'Invalid validator information, signature statistics not updated');
        return;
      }

      // Get or create validator stats
      let stats = await validatorSignatureRepository.getSignatureStats(
        validatorInfo.operator_address,
        this.network
      );

      // Create new stats object
      if (!stats) {
        stats = {
          validatorAddress: validatorInfo.operator_address,
          totalSignedBlocks: 0,
          totalBlocksInWindow: 0,
          signatureRate: 0,
          consecutiveSigned: 0,
          consecutiveMissed: 0,
          network: this.network,
          recentBlocks: [],
          lastUpdated: new Date()
        };
      }

      // Add new block information
      const newBlockInfo: ValidatorBlockInfo = {
        blockHeight,
        signed,
        round,
        timestamp
      };

      // Update the list of recent blocks
      stats.recentBlocks.unshift(newBlockInfo);

      // Limit the number of recent blocks
      if (stats.recentBlocks.length > this.constants.RECENT_BLOCKS_LIMIT) {
        stats.recentBlocks = stats.recentBlocks.slice(0, this.constants.RECENT_BLOCKS_LIMIT);
      }

      // Update consecutive signature counters
      if (signed) {
        stats.consecutiveSigned++;
        stats.consecutiveMissed = 0;
      } else {
        stats.consecutiveMissed++;
        stats.consecutiveSigned = 0;
      }

      // A counter that counts all blocks in the performance window
      const windowBlockCount = Math.min(stats.totalBlocksInWindow + 1, this.constants.SIGNATURE_PERFORMANCE_WINDOW);

      // Update the number of signed blocks
      if (signed) {
        // If the window is full and the oldest block is signed, remove it
        if (stats.totalBlocksInWindow >= this.constants.SIGNATURE_PERFORMANCE_WINDOW) {
          // Keep the signature rate
        } else {
          stats.totalSignedBlocks++;
        }
      } else {
        // If the window is full and the oldest block is not signed, do nothing
        if (stats.totalBlocksInWindow >= this.constants.SIGNATURE_PERFORMANCE_WINDOW) {
          // Keep the signature rate
        }
      }

      // Update the total number of blocks
      stats.totalBlocksInWindow = windowBlockCount;

      // Calculate the signature rate
      stats.signatureRate = stats.totalBlocksInWindow > 0
        ? (stats.totalSignedBlocks / stats.totalBlocksInWindow) * 100
        : 0;

      // Set the last update time
      stats.lastUpdated = new Date();

      // Save to database
      await validatorSignatureRepository.saveSignatureStats(stats);

      // Cache the updated stats
      this.validatorStatsCache.set(validatorInfo.operator_address, stats);

      // Check thresholds and send alerts if necessary
      await this.notificationService.checkSignatureThresholds(stats);

    } catch (error) {
      logger.error({
        error,
        validatorAddress: validatorInfo?.operator_address || 'unknown',
        validatorMoniker: validatorInfo?.moniker || 'unknown',
        blockHeight,
        network: this.network,
      }, 'Error updating validator signature statistics');
    }
  }

  /**
   * Get validator signature statistics
   */
  async getValidatorStats(validatorAddress: string): Promise<ValidatorSignatureStats | null> {
    // Check the cache first
    const cachedStats = this.validatorStatsCache.get(validatorAddress);
    if (cachedStats) return cachedStats;
    
    // Get from database if not in cache
    try {
      const stats = await validatorSignatureRepository.getSignatureStats(validatorAddress, this.network);
      
      // Add to cache if found
      if (stats) {
        this.validatorStatsCache.set(validatorAddress, stats);
      }
      
      return stats;
    } catch (error) {
      logger.error({ error, validatorAddress, network: this.network }, 'Error getting validator signature statistics');
      return null;
    }
  }

  /**
   * Get all validator signature statistics
   */
  async getAllValidatorStats(): Promise<ValidatorSignatureStats[]> {
    try {
      const stats = await validatorSignatureRepository.getAllSignatureStats(this.network);
      return stats;
    } catch (error) {
      logger.error({ error, network: this.network }, 'Error getting all validator signature statistics');
      return [];
    }
  }

  /**
   * Clear the stats cache
   */
  clearCache(): void {
    this.validatorStatsCache.clear();
    logger.debug('Validator signature stats cache cleared');
  }
} 