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
      alertState.lastAlertedSignatureRate = currentRate;
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

    if (canSendAlert) {
      await this.sendRecentMissedBlocksAlert(stats, recentMissed);
      alertState.sentMissedBlockAlert = true;
      alertState.lastCriticalAlertTime = now;
    } else {
      logger.debug({
        fpBtcPkHex: stats.fpBtcPkHex,
        moniker: stats.moniker,
        recentMissed
      }, 'There are missed signatures in the recent blocks, but not enough time has passed since the previous notification');
    }
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