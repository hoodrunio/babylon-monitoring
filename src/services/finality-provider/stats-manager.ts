import { FinalityProviderInfo, FinalityProviderSignatureStats } from '../../models/finality-provider-signature.model';
import finalityProviderSignatureRepository from '../../database/repositories/finality-provider-signature.repository';
import logger from '../../utils/logger';
import { Network } from '../../config/config';
import { MonitoringServiceOptions } from '../monitoring-service.interface';
import { NotificationService } from './notification-service';

/**
 * Service that manages Finality Provider signature statistics
 */
export class StatsManager {
  constructor(
    private readonly network: Network,
    private readonly options: MonitoringServiceOptions,
    private readonly notificationService: NotificationService,
    private readonly activeProviders: Set<string>,
    private readonly providerInfoMap: Map<string, FinalityProviderInfo>
  ) {}

  /**
   * Updates the statistics of a finality provider
   */
  async updateFinalityProviderStats(fpBtcPkHex: string): Promise<void> {
    try {
      // Get current statistics
      const stats = await finalityProviderSignatureRepository.getSignatureStats(fpBtcPkHex, this.network);
      if (!stats) {
        return;
      }

      // Get provider info
      const fpInfo = this.providerInfoMap.get(fpBtcPkHex);

      // Check if active
      const isActive = this.activeProviders.has(fpBtcPkHex);

      // Update provider information
      stats.moniker = fpInfo?.moniker;
      stats.fpBtcAddress = fpInfo?.fpBtcAddress;
      stats.ownerAddress = fpInfo?.ownerAddress;
      stats.description = fpInfo?.description;
      stats.jailed = fpInfo?.jailed;
      stats.isActive = isActive;
      stats.lastUpdated = new Date();

      // Save updated statistics
      await finalityProviderSignatureRepository.saveSignatureStats(stats);

      // Notification checks
      if (this.shouldSendAlert(fpBtcPkHex)) {
        // Check signature rate
        await this.notificationService.checkAndSendSignatureRateAlert(stats);

        // Get recent missed blocks count from stored missedBlockHeights
        const recentMissedCount = stats.missedBlockHeights.filter(h => h >= stats.endHeight - 5).length;
        if (recentMissedCount >= 3) {
          await this.notificationService.checkAndSendRecentMissedBlocksAlert(stats, recentMissedCount);
        }
      }
    } catch (error) {
      logger.error({ error, fpBtcPkHex }, 'Error updating finality provider statistics');
    }
  }

  /**
   * Updates the statistics of all finality providers
   */
  async updateAllFinalityProviderStats(): Promise<void> {
    try {
      // Get all statistics
      const allStats = await finalityProviderSignatureRepository.getAllSignatureStats(this.network);

      // Update for each finality provider
      for (const stat of allStats) {
        // Check if the provider is active
        const isActive = this.activeProviders.has(stat.fpBtcPkHex);

        // Get provider information
        const fpInfo = this.providerInfoMap.get(stat.fpBtcPkHex);

        if (fpInfo) {
          // Also update provider information
          fpInfo.isActive = isActive;
          await finalityProviderSignatureRepository.saveFinalityProviderInfo(fpInfo);
        }

        // Updated stats
        const updatedStats: FinalityProviderSignatureStats = {
          ...stat,
          isActive,
          jailed: fpInfo?.jailed
        };

        // Save to database
        await finalityProviderSignatureRepository.saveSignatureStats(updatedStats);
      }

      logger.info(`All finality provider statistics updated (${this.network})`);
    } catch (error) {
      logger.error({ error }, 'Error updating all finality provider statistics');
    }
  }

  /**
   * Checks whether to send a notification
   */
  shouldSendAlert(fpBtcPkHex: string): boolean {
    // Get provider information
    const fpInfo = this.providerInfoMap.get(fpBtcPkHex);

    // Do not send a notification if there is no provider information
    if (!fpInfo) {
      return false;
    }

    // Check the status of the provider:
    // 1. Should not be jailed
    // 2. Must be in the active finality provider set
    const isJailed = fpInfo.jailed === true;
    const isActive = this.activeProviders.has(fpBtcPkHex);

    // Send notification if not jailed and in the active finality provider set
    return !isJailed && isActive;
  }

  /**
   * Checks whether a specific provider should be tracked
   */
  shouldTrackProvider(fpBtcPkHex: string): boolean {
    // If a tracking list is defined, only track those in the list
    if (this.options?.trackedAddresses && this.options.trackedAddresses.length > 0) {
      return this.options.trackedAddresses.includes(fpBtcPkHex);
    }
    // Otherwise track all
    return true;
  }

  /**
   * Updates the statistics of a finality provider with a new signature
   */
  async updateFinalityProviderStatsWithSignature(fpBtcPkHex: string, height: number, signed: boolean): Promise<void> {
    try {
      // Get current statistics
      let stats = await finalityProviderSignatureRepository.getSignatureStats(fpBtcPkHex, this.network);
      
      // Get provider info
      const fpInfo = this.providerInfoMap.get(fpBtcPkHex);
      
      // Check if active
      const isActive = this.activeProviders.has(fpBtcPkHex);
      
      if (!stats) {
        // Create new statistics if none exist
        stats = {
          fpBtcPkHex,
          moniker: fpInfo?.moniker,
          fpBtcAddress: fpInfo?.fpBtcAddress,
          ownerAddress: fpInfo?.ownerAddress,
          description: fpInfo?.description,
          startHeight: height,
          endHeight: height,
          totalBlocks: 1,
          signedBlocks: signed ? 1 : 0,
          missedBlocks: signed ? 0 : 1,
          signatureRate: signed ? 100 : 0,
          network: this.network,
          lastUpdated: new Date(),
          missedBlockHeights: signed ? [] : [height],
          jailed: fpInfo?.jailed,
          isActive
        };
      } else {
        // Update existing statistics
        stats.totalBlocks += 1;
        
        if (signed) {
          stats.signedBlocks += 1;
        } else {
          stats.missedBlocks += 1;
          stats.missedBlockHeights.push(height);
          
          // Keep only the most recent missed block heights (up to 100)
          if (stats.missedBlockHeights.length > 100) {
            stats.missedBlockHeights = stats.missedBlockHeights.slice(-100);
          }
        }
        
        // Update height range
        stats.startHeight = Math.min(stats.startHeight, height);
        stats.endHeight = Math.max(stats.endHeight, height);
        
        // Recalculate signature rate
        stats.signatureRate = (stats.signedBlocks / stats.totalBlocks) * 100;
        
        // Update provider info
        stats.moniker = fpInfo?.moniker;
        stats.fpBtcAddress = fpInfo?.fpBtcAddress;
        stats.ownerAddress = fpInfo?.ownerAddress;
        stats.description = fpInfo?.description;
        stats.jailed = fpInfo?.jailed;
        stats.isActive = isActive;
        stats.lastUpdated = new Date();
      }
      
      // Save updated statistics
      await finalityProviderSignatureRepository.saveSignatureStats(stats);
      
      // Notification checks
      if (this.shouldSendAlert(fpBtcPkHex)) {
        // Check signature rate
        await this.notificationService.checkAndSendSignatureRateAlert(stats);
        
        // Get recent missed blocks count - this requires a different implementation
        // since we no longer have the full history in the database
        const recentMissedCount = stats.missedBlockHeights.filter(h => h >= height - 5).length;
        if (recentMissedCount >= 3) {
          await this.notificationService.checkAndSendRecentMissedBlocksAlert(stats, recentMissedCount);
        }
      }
    } catch (error) {
      logger.error({ error, fpBtcPkHex, height }, 'Error updating finality provider statistics with signature');
    }
  }
}