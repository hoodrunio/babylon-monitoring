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
    const alert: AlertPayload = {
      title: `Finality Provider Low Signature Rate: ${stats.moniker || stats.fpBtcPkHex.substring(0, 8)}`,
      message: `Finality Provider (${stats.moniker || stats.fpBtcPkHex.substring(0, 8)}) has a signature rate of ${stats.signatureRate.toFixed(2)}% for the last ${stats.totalBlocks} blocks. Signature rate dropped to ${rateStep}%. Threshold: ${this.options?.blockThreshold || 90}%`,
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
        isActive: stats.isActive
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
    const alert: AlertPayload = {
      title: `Finality Provider Signature Rate Recovering: ${stats.moniker || stats.fpBtcPkHex.substring(0, 8)}`,
      message: `Finality Provider (${stats.moniker || stats.fpBtcPkHex.substring(0, 8)}) signature rate is recovering. Current rate: ${stats.signatureRate.toFixed(2)}%`,
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
        isActive: stats.isActive
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
    const alert: AlertPayload = {
      title: `Finality Provider Missing Signatures in Recent Blocks: ${stats.moniker || stats.fpBtcPkHex.substring(0, 8)}`,
      message: `Finality Provider (${stats.moniker || stats.fpBtcPkHex.substring(0, 8)}) missed ${recentMissed} block signatures within the last 5 blocks. Please check the node status.`,
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
        isActive: stats.isActive
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
    // Changed from jailed to active
    if (previousJailed === true && currentJailed === false) {
      const alert: AlertPayload = {
        title: `Finality Provider Became Active: ${fpInfo.moniker || fpInfo.fpBtcPkHex.substring(0, 8)}`,
        message: `Finality Provider (${fpInfo.moniker || fpInfo.fpBtcPkHex.substring(0, 8)}) is no longer jailed and has become active.`,
        severity: AlertSeverity.INFO,
        network: this.network,
        timestamp: new Date(),
        metadata: {
          fpBtcPkHex: fpInfo.fpBtcPkHex,
          ownerAddress: fpInfo.ownerAddress,
          previousStatus: 'jailed',
          currentStatus: 'active'
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
        title: `Finality Provider Became Jailed: ${fpInfo.moniker || fpInfo.fpBtcPkHex.substring(0, 8)}`,
        message: `Finality Provider (${fpInfo.moniker || fpInfo.fpBtcPkHex.substring(0, 8)}) has changed from active to jailed.`,
        severity: AlertSeverity.CRITICAL,
        network: this.network,
        timestamp: new Date(),
        metadata: {
          fpBtcPkHex: fpInfo.fpBtcPkHex,
          ownerAddress: fpInfo.ownerAddress,
          previousStatus: 'active',
          currentStatus: 'jailed'
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