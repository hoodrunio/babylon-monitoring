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
      // Get recent signatures
      const recentSignatures = await finalityProviderSignatureRepository.getRecentSignatures(
        fpBtcPkHex,
        this.network,
        100 // Last 100 blocks
      );

      if (recentSignatures.length === 0) {
        return;
      }

      // Sort signatures (descending)
      const sortedSignatures = recentSignatures.sort((a, b) => b.blockHeight - a.blockHeight);

      // Determine the block range
      const startHeight = sortedSignatures[sortedSignatures.length - 1].blockHeight;
      const endHeight = sortedSignatures[0].blockHeight;

      // Number of signatures
      let signedBlocks = 0;
      const missedBlockHeights: number[] = [];

      // Count signatures
      for (const sig of sortedSignatures) {
        if (sig.signed) {
          signedBlocks++;
        } else {
          missedBlockHeights.push(sig.blockHeight);
        }
      }

      // Get provider info
      const fpInfo = this.providerInfoMap.get(fpBtcPkHex);

      // Check if active
      const isActive = this.activeProviders.has(fpBtcPkHex);

      // Create statistics
      const stats: FinalityProviderSignatureStats = {
        fpBtcPkHex,
        moniker: fpInfo?.moniker,
        fpBtcAddress: fpInfo?.fpBtcAddress,
        ownerAddress: fpInfo?.ownerAddress,
        description: fpInfo?.description,
        startHeight,
        endHeight,
        totalBlocks: sortedSignatures.length,
        signedBlocks,
        missedBlocks: sortedSignatures.length - signedBlocks,
        signatureRate: (signedBlocks / sortedSignatures.length) * 100,
        network: this.network,
        lastUpdated: new Date(),
        missedBlockHeights,
        jailed: fpInfo?.jailed,
        isActive
      };

      // Save statistics
      await finalityProviderSignatureRepository.saveSignatureStats(stats);

      // Notification checks
      if (this.shouldSendAlert(fpBtcPkHex)) {
        // Check signature rate
        await this.notificationService.checkAndSendSignatureRateAlert(stats);

        // If more than one block is missed in the last 5 blocks
        const recentMissed = sortedSignatures.slice(0, 5).filter(s => !s.signed).length;
        if (recentMissed >= 3) {
          await this.notificationService.checkAndSendRecentMissedBlocksAlert(stats, recentMissed);
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
}