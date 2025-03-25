import { FinalityProviderInfo, FinalityProviderSignatureStats } from '../../models/finality-provider-signature.model';
import notificationManager from '../../notifiers/notification-manager';
import { AlertPayload, AlertSeverity } from '../../notifiers/notifier.interface';
import { Network } from '../../config/config';
import { MonitoringServiceOptions } from '../monitoring-service.interface';
import { ProviderAlertState } from './types';
import logger from '../../utils/logger';

/**
 * Service that manages Finality Provider notifications
 */
export class NotificationService {
  // Tracks the notification status for each provider
  private alertStates: Map<string, ProviderAlertState> = new Map();

  constructor(
    private readonly network: Network,
    private readonly options: MonitoringServiceOptions,
    private readonly signatureRateThresholdStep: number = 5
  ) {}

  /**
   * Gets the notification state for a specific provider
   */
  private getAlertState(fpBtcPkHex: string): ProviderAlertState {
    if (!this.alertStates.has(fpBtcPkHex)) {
      // Create a new state for providers encountered for the first time
      this.alertStates.set(fpBtcPkHex, {
        lastAlertedSignatureRate: 100, // Assume 100% initially
        isRecovering: false,
        sentMissedBlockAlert: false,
        sentUptimeAlert: false
      });
    }

    return this.alertStates.get(fpBtcPkHex)!;
  }

  /**
   * Logic for sending low signature rate notifications
   */
  async checkAndSendSignatureRateAlert(stats: FinalityProviderSignatureStats): Promise<void> {
    const alertState = this.getAlertState(stats.fpBtcPkHex);
    const currentRate = stats.signatureRate;
    const blockThreshold = this.options?.blockThreshold || 90;

    // If the signature rate is below the threshold
    if (currentRate < blockThreshold) {
      // Step change control - send notification for every 5% drop
      const lastRateStep = Math.floor(alertState.lastAlertedSignatureRate / this.signatureRateThresholdStep) * this.signatureRateThresholdStep;
      const currentRateStep = Math.floor(currentRate / this.signatureRateThresholdStep) * this.signatureRateThresholdStep;

      // If there is a new step decrease or no notification has been sent before
      if (currentRateStep < lastRateStep || alertState.lastAlertedSignatureRate === 100) {
        await this.sendLowSignatureRateAlert(stats, currentRateStep);
        alertState.lastAlertedSignatureRate = currentRate;

        // Reset recovery status
        alertState.isRecovering = false;
      }
    }
    // Recovery check - if it is above the threshold and was previously low
    else if (currentRate >= blockThreshold && alertState.lastAlertedSignatureRate < blockThreshold && !alertState.isRecovering) {
      await this.sendSignatureRateRecoveringAlert(stats);
      alertState.isRecovering = true;
      
      // Don't reset lastAlertedSignatureRate here, we need to keep track of previous status
      // We'll set it to a value that won't trigger new alerts until rate drops again
      alertState.lastAlertedSignatureRate = currentRate;
    }
    // If provider is already in recovery state and continues to perform well
    else if (currentRate >= blockThreshold && alertState.isRecovering) {
      // After some time (e.g., 5 percentage points increase from recovery) reset recovery state
      // so provider can go through the normal alert cycle again if needed
      if (currentRate - alertState.lastAlertedSignatureRate >= 5) {
        logger.debug({
          fpBtcPkHex: stats.fpBtcPkHex,
          moniker: stats.moniker,
          currentRate: currentRate,
          lastAlertedRate: alertState.lastAlertedSignatureRate
        }, 'Resetting recovery state after sustained improvement');
        
        alertState.isRecovering = false;
        alertState.lastAlertedSignatureRate = 100; // Reset to default
      }
    }
  }

  /**
   * Check for recent block miss notification
   */
  async checkAndSendRecentMissedBlocksAlert(stats: FinalityProviderSignatureStats, recentMissed: number): Promise<void> {
    const alertState = this.getAlertState(stats.fpBtcPkHex);

    // If no notification has been sent before or at least 1 hour has passed since the last notification
    const now = new Date();
    const canSendAlert = !alertState.sentMissedBlockAlert ||
                         !alertState.lastCriticalAlertTime ||
                         ((now.getTime() - alertState.lastCriticalAlertTime.getTime()) > 3600000); // 1 hour

    if (canSendAlert && recentMissed >= 3) {
      await this.sendRecentMissedBlocksAlert(stats, recentMissed);
      alertState.sentMissedBlockAlert = true;
      alertState.lastCriticalAlertTime = now;
    } else if (alertState.sentMissedBlockAlert && recentMissed === 0) {
      // Provider was missing blocks but now is signing consecutively
      // Check if there are recent missed blocks within the last few blocks
      const recentSigningCount = 5; // We want at least 5 consecutive signed blocks
      
      // If missedBlockHeights is empty or all missed blocks are outside our recent window
      // Consider more recent blocks (higher block numbers) first
      const noRecentMissedBlocks = stats.missedBlockHeights.length === 0 || 
                                   !this.hasRecentlyMissedBlocks(stats.missedBlockHeights, recentSigningCount);
      
      if (noRecentMissedBlocks) {
        await this.sendConsecutiveSigningRecoveryAlert(stats);
        alertState.sentMissedBlockAlert = false;
      }
    } else {
      logger.debug({
        fpBtcPkHex: stats.fpBtcPkHex,
        moniker: stats.moniker,
        recentMissed
      }, 'There are missed signatures in the recent blocks, but not enough time has passed since the previous notification');
    }
  }

  /**
   * Checks if the provider has missed blocks recently
   * @param missedBlockHeights Array of block heights where signatures were missed
   * @param recentBlockCount Number of recent blocks to check
   * @returns boolean True if there are missed blocks in the recent window
   */
  private hasRecentlyMissedBlocks(missedBlockHeights: number[], recentBlockCount: number): boolean {
    if (missedBlockHeights.length === 0) {
      return false; // No missed blocks at all
    }
    
    // Sort the heights in descending order (more recent blocks first)
    const sortedHeights = [...missedBlockHeights].sort((a, b) => b - a);
    
    // Get the most recent block height from the missed blocks
    const mostRecentMissedHeight = sortedHeights[0];
    
    // We need recentBlockCount consecutive blocks without misses
    // So if the most recent missed block is within the last recentBlockCount blocks,
    // we haven't had enough consecutive signed blocks yet
    
    // Since we don't have the current block height in the stats,
    // we'll use a simple approach - if the most recent missed block is less than
    // recentBlockCount blocks away from another missed block, we're not in a recovery state yet
    
    // If there's only one missed block, we can consider it as having recovered
    // after that single block (since we already know recentMissed is 0)
    if (sortedHeights.length === 1) {
      return false; // Only one missed block, and it's not recent (recentMissed is 0)
    }
    
    // Check if the gap between the most recent missed block and the second most recent
    // is at least recentBlockCount (this means recentBlockCount consecutive blocks were signed)
    const secondMostRecentMissedHeight = sortedHeights[1];
    const consecutiveSignedBlocks = mostRecentMissedHeight - secondMostRecentMissedHeight - 1;
    
    // If we have at least recentBlockCount consecutive signed blocks, then we've recovered
    return consecutiveSignedBlocks < recentBlockCount;
  }

  /**
   * Sends low signature rate notification
   */
  private async sendLowSignatureRateAlert(stats: FinalityProviderSignatureStats, rateStep: number): Promise<void> {
    const providerName = stats.moniker || stats.fpBtcPkHex.substring(0, 8);
    const providerLink = `https://testnet.babylon.hoodscan.io/staking/providers/${stats.fpBtcPkHex}`;
    
    const alert: AlertPayload = {
      title: `📉 Low Signature Rate | ${providerName}`,
      message: `Finality Provider signature rate has decreased to ${stats.signatureRate.toFixed(2)}%.\n\nProvider Details:\n• Name: ${providerName}\n• Owner: ${stats.ownerAddress}\n• Status: ${stats.jailed ? '🔒 Jailed' : (stats.isActive ? '✅ Active' : '❌ Inactive')}\n• Explorer: [View on Hoodscan](${providerLink})\n\nPerformance:\n• Signature Rate: ${stats.signatureRate.toFixed(2)}%\n• Step: ${rateStep}%\n• Signed: ${stats.signedBlocks}/${stats.totalBlocks} blocks\n• Threshold: ${this.options?.blockThreshold || 90}%`,
      severity: AlertSeverity.WARNING,
      network: this.network,
      timestamp: new Date(),
      metadata: {
        fpBtcPkHex: stats.fpBtcPkHex,
        ownerAddress: stats.ownerAddress,
        signatureRate: stats.signatureRate,
        rateStep: rateStep,
        totalBlocks: stats.totalBlocks,
        signedBlocks: stats.signedBlocks,
        missedBlocks: stats.missedBlocks,
        jailed: stats.jailed,
        isActive: stats.isActive,
        providerLink
      }
    };

    await notificationManager.sendAlert(alert);
    logger.info({
      fpBtcPkHex: stats.fpBtcPkHex,
      moniker: stats.moniker,
      signatureRate: stats.signatureRate,
      rateStep
    }, 'Low signature rate notification sent');
  }

  /**
   * Sends signature rate recovery notification
   */
  private async sendSignatureRateRecoveringAlert(stats: FinalityProviderSignatureStats): Promise<void> {
    const providerName = stats.moniker || stats.fpBtcPkHex.substring(0, 8);
    const providerLink = `https://testnet.babylon.hoodscan.io/staking/providers/${stats.fpBtcPkHex}`;
    
    const alert: AlertPayload = {
      title: `🔄 Signature Rate Recovering | ${providerName}`,
      message: `Finality Provider signature rate is recovering.\n\nProvider Details:\n• Name: ${providerName}\n• Owner: ${stats.ownerAddress}\n• Status: ${stats.jailed ? '🔒 Jailed' : (stats.isActive ? '✅ Active' : '❌ Inactive')}\n• Explorer: [View on Hoodscan](${providerLink})\n\nPerformance:\n• Current Rate: ${stats.signatureRate.toFixed(2)}%\n• Signed: ${stats.signedBlocks}/${stats.totalBlocks} blocks`,
      severity: AlertSeverity.INFO,
      network: this.network,
      timestamp: new Date(),
      metadata: {
        fpBtcPkHex: stats.fpBtcPkHex,
        ownerAddress: stats.ownerAddress,
        signatureRate: stats.signatureRate,
        totalBlocks: stats.totalBlocks,
        signedBlocks: stats.signedBlocks,
        missedBlocks: stats.missedBlocks,
        jailed: stats.jailed,
        isActive: stats.isActive,
        providerLink
      }
    };

    await notificationManager.sendAlert(alert);
    logger.info({
      fpBtcPkHex: stats.fpBtcPkHex,
      moniker: stats.moniker,
      signatureRate: stats.signatureRate
    }, 'Signature rate recovery notification sent');
  }

  /**
   * Sends recent block miss notification
   */
  private async sendRecentMissedBlocksAlert(stats: FinalityProviderSignatureStats, recentMissed: number): Promise<void> {
    const providerName = stats.moniker || stats.fpBtcPkHex.substring(0, 8);
    const providerLink = `https://testnet.babylon.hoodscan.io/staking/providers/${stats.fpBtcPkHex}`;
    const missedHeights = stats.missedBlockHeights.slice(0, 5).join(', ');
    
    const alert: AlertPayload = {
      title: `⚠️ Recent Block Signatures Missed | ${providerName}`,
      message: `Finality Provider missed ${recentMissed} block signatures in the last 5 blocks.\n\nProvider Details:\n• Name: ${providerName}\n• Owner: ${stats.ownerAddress}\n• Status: ${stats.jailed ? '🔒 Jailed' : (stats.isActive ? '✅ Active' : '❌ Inactive')}\n• Explorer: [View on Hoodscan](${providerLink})\n\nMissed Blocks:\n• Heights: ${missedHeights}\n• Overall Rate: ${stats.signatureRate.toFixed(2)}%\n\n⚠️ Please check the node status immediately.`,
      severity: AlertSeverity.CRITICAL,
      network: this.network,
      timestamp: new Date(),
      metadata: {
        fpBtcPkHex: stats.fpBtcPkHex,
        ownerAddress: stats.ownerAddress,
        recentMissedCount: recentMissed,
        signatureRate: stats.signatureRate,
        missedBlockHeights: stats.missedBlockHeights.slice(0, 5),
        jailed: stats.jailed,
        isActive: stats.isActive,
        providerLink
      }
    };

    await notificationManager.sendAlert(alert);
    logger.info({
      fpBtcPkHex: stats.fpBtcPkHex,
      moniker: stats.moniker,
      recentMissed
    }, 'Recent block miss notification sent');
  }

  /**
   * Sends consecutive signing recovery notification
   */
  private async sendConsecutiveSigningRecoveryAlert(stats: FinalityProviderSignatureStats): Promise<void> {
    const providerName = stats.moniker || stats.fpBtcPkHex.substring(0, 8);
    const providerLink = `https://testnet.babylon.hoodscan.io/staking/providers/${stats.fpBtcPkHex}`;
    
    const alert: AlertPayload = {
      title: `🔄 Block Signing Recovered | ${providerName}`,
      message: `Finality Provider has recovered and is now signing blocks consecutively.\n\nProvider Details:\n• Name: ${providerName}\n• Owner: ${stats.ownerAddress}\n• Status: ${stats.jailed ? '🔒 Jailed' : (stats.isActive ? '✅ Active' : '❌ Inactive')}\n• Explorer: [View on Hoodscan](${providerLink})\n\nPerformance:\n• Current Rate: ${stats.signatureRate.toFixed(2)}%\n• Signed: ${stats.signedBlocks}/${stats.totalBlocks} blocks`,
      severity: AlertSeverity.INFO,
      network: this.network,
      timestamp: new Date(),
      metadata: {
        fpBtcPkHex: stats.fpBtcPkHex,
        ownerAddress: stats.ownerAddress,
        signatureRate: stats.signatureRate,
        totalBlocks: stats.totalBlocks,
        signedBlocks: stats.signedBlocks,
        missedBlocks: stats.missedBlocks,
        jailed: stats.jailed,
        isActive: stats.isActive,
        providerLink
      }
    };

    await notificationManager.sendAlert(alert);
    logger.info({
      fpBtcPkHex: stats.fpBtcPkHex,
      moniker: stats.moniker,
      signatureRate: stats.signatureRate
    }, 'Consecutive block signing recovery notification sent');
  }

  /**
   * Sends jailed status change notification
   */
  async sendJailedStatusChangeAlert(fpInfo: FinalityProviderInfo, previousJailed: boolean, currentJailed: boolean): Promise<void> {
    const providerName = fpInfo.moniker || fpInfo.fpBtcPkHex.substring(0, 8);
    const providerLink = `https://testnet.babylon.hoodscan.io/staking/providers/${fpInfo.fpBtcPkHex}`;
    
    // Changed from jailed to active
    if (previousJailed === true && currentJailed === false) {
      const alert: AlertPayload = {
        title: `✅ Provider Status: Active | ${providerName}`,
        message: `Finality Provider is now active and no longer jailed.\n\nProvider Details:\n• Name: ${providerName}\n• Owner: ${fpInfo.ownerAddress}\n• Status Change: 🔒 Jailed → ✅ Active\n• Explorer: [View on Hoodscan](${providerLink})`,
        severity: AlertSeverity.INFO,
        network: this.network,
        timestamp: new Date(),
        metadata: {
          fpBtcPkHex: fpInfo.fpBtcPkHex,
          ownerAddress: fpInfo.ownerAddress,
          previousStatus: 'jailed',
          currentStatus: 'active',
          providerLink
        }
      };

      await notificationManager.sendAlert(alert);
      logger.info({
        fpBtcPkHex: fpInfo.fpBtcPkHex,
        moniker: fpInfo.moniker
      }, 'Finality Provider changed from jailed to active');
    }
    // Changed from active to jailed
    else if (previousJailed === false && currentJailed === true) {
      const alert: AlertPayload = {
        title: `🔒 Provider Status: Jailed | ${providerName}`,
        message: `Finality Provider has been jailed.\n\nProvider Details:\n• Name: ${providerName}\n• Owner: ${fpInfo.ownerAddress}\n• Status Change: ✅ Active → 🔒 Jailed\n• Explorer: [View on Hoodscan](${providerLink})\n\n⚠️ Immediate action required to restore service.`,
        severity: AlertSeverity.CRITICAL,
        network: this.network,
        timestamp: new Date(),
        metadata: {
          fpBtcPkHex: fpInfo.fpBtcPkHex,
          ownerAddress: fpInfo.ownerAddress,
          previousStatus: 'active',
          currentStatus: 'jailed',
          providerLink
        }
      };

      await notificationManager.sendAlert(alert);
      logger.info({
        fpBtcPkHex: fpInfo.fpBtcPkHex,
        moniker: fpInfo.moniker
      }, 'Finality Provider changed from active to jailed');
    }
  }

  /**
   * Resets all notification states
   */
  resetAlertStates(): void {
    this.alertStates.clear();
  }
}