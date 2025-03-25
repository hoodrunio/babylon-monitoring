import logger from '../../utils/logger';
import { Network } from '../../config/config';
import { MonitoringServiceOptions } from '../monitoring-service.interface';
import { ValidatorSignatureStats } from '../../models/validator-signature.model';
import notificationManager from '../../notifiers/notification-manager';
import { AlertPayload, AlertSeverity } from '../../notifiers/notifier.interface';
import { ValidatorAlertState } from './types';

/**
 * Class for handling validator signature notifications and alerts
 */
export class NotificationService {
  private alertStates: Map<string, ValidatorAlertState> = new Map();

  constructor(
    private readonly network: Network,
    private readonly options: MonitoringServiceOptions,
  ) {}

  /**
   * Checks signature thresholds and sends alerts if necessary
   */
  async checkSignatureThresholds(stats: ValidatorSignatureStats): Promise<void> {
    await this.checkSignatureRateThreshold(stats);
    await this.checkConsecutiveMissedBlocks(stats);
  }

  /**
   * Checks the signature rate threshold and sends an alert if necessary
   */
  private async checkSignatureRateThreshold(stats: ValidatorSignatureStats): Promise<void> {
    const threshold = this.options.validatorSignatureThreshold || 90;

    // Get or create alert state for this validator
    const alertState = this.getAlertState(stats.validatorAddress);

    // If at least 100 blocks analyzed and signature rate is below threshold
    if (stats.totalBlocksInWindow >= 100 && stats.signatureRate < threshold) {
      // Check if we've already alerted at this rate or worse
      if (!alertState.lastAlertedSignatureRate || 
          stats.signatureRate < alertState.lastAlertedSignatureRate - 5) {
        await this.sendLowSignatureRateAlert(stats);
        alertState.lastAlertedSignatureRate = stats.signatureRate;
        alertState.isRecovering = false;
      }
    } else if (stats.totalBlocksInWindow >= 100 && 
               stats.signatureRate >= threshold && 
               !alertState.isRecovering && 
               alertState.lastAlertedSignatureRate) {
      // Recovery notification
      await this.sendSignatureRateRecoveryAlert(stats);
      alertState.isRecovering = true;
    }

    // Update the alert state
    this.alertStates.set(stats.validatorAddress, alertState);
  }

  /**
   * Checks consecutive missed blocks and sends an alert if necessary
   */
  private async checkConsecutiveMissedBlocks(stats: ValidatorSignatureStats): Promise<void> {
    // Get alert state for this validator
    const alertState = this.getAlertState(stats.validatorAddress);

    // If 5 or more consecutive blocks missed and not yet alerted
    if (stats.consecutiveMissed >= 5 && !alertState.sentConsecutiveBlocksAlert) {
      await this.sendConsecutiveMissedBlocksAlert(stats);
      alertState.sentConsecutiveBlocksAlert = true;
      alertState.lastCriticalAlertTime = new Date();
    } else if (stats.consecutiveMissed === 0 && alertState.sentConsecutiveBlocksAlert) {
      // Reset the flag when no longer missing consecutive blocks
      alertState.sentConsecutiveBlocksAlert = false;
    }

    // Update the alert state
    this.alertStates.set(stats.validatorAddress, alertState);
  }

  /**
   * Sends a low signature rate alert
   */
  private async sendLowSignatureRateAlert(stats: ValidatorSignatureStats): Promise<void> {
    const message = `Validator low signature rate detected: ${stats.validatorAddress} - Rate: %${stats.signatureRate.toFixed(2)}`;

    const alertPayload: AlertPayload = {
      title: 'Validator Low Signature Rate',
      message,
      severity: AlertSeverity.WARNING,
      network: this.network,
      timestamp: new Date(),
      metadata: {
        validatorAddress: stats.validatorAddress,
        network: stats.network,
        signatureRate: stats.signatureRate
      }
    };

    await notificationManager.sendAlert(alertPayload);
    logger.info({ validatorAddress: stats.validatorAddress, rate: stats.signatureRate }, 'Low signature rate alert sent');
  }

  /**
   * Sends a signature rate recovery alert
   */
  private async sendSignatureRateRecoveryAlert(stats: ValidatorSignatureStats): Promise<void> {
    const message = `Validator signature rate recovered: ${stats.validatorAddress} - Rate: %${stats.signatureRate.toFixed(2)}`;

    const alertPayload: AlertPayload = {
      title: 'Validator Signature Rate Recovered',
      message,
      severity: AlertSeverity.INFO,
      network: this.network,
      timestamp: new Date(),
      metadata: {
        validatorAddress: stats.validatorAddress,
        network: stats.network,
        signatureRate: stats.signatureRate
      }
    };

    await notificationManager.sendAlert(alertPayload);
    logger.info({ validatorAddress: stats.validatorAddress, rate: stats.signatureRate }, 'Signature rate recovery alert sent');
  }

  /**
   * Sends an alert for consecutive missed blocks
   */
  private async sendConsecutiveMissedBlocksAlert(stats: ValidatorSignatureStats): Promise<void> {
    const message = `Validator consecutive ${stats.consecutiveMissed} blocks missed: ${stats.validatorAddress}`;

    const alertPayload: AlertPayload = {
      title: 'Validator Consecutive Blocks Missed',
      message,
      severity: AlertSeverity.CRITICAL,
      network: this.network,
      timestamp: new Date(),
      metadata: {
        validatorAddress: stats.validatorAddress,
        network: stats.network,
        consecutiveMissed: stats.consecutiveMissed
      }
    };

    await notificationManager.sendAlert(alertPayload);
    logger.info({ validatorAddress: stats.validatorAddress, consecutiveMissed: stats.consecutiveMissed }, 'Consecutive missed blocks alert sent');
  }

  /**
   * Validator jailed bildirimini gönderir
   */
  async sendValidatorJailedAlert(validatorAddress: string, moniker: string): Promise<void> {
    const message = `Validator ${moniker} (${validatorAddress}) jailed durumuna geçti`;

    const alertPayload: AlertPayload = {
      title: 'Validator Jailed',
      message,
      severity: AlertSeverity.CRITICAL,
      network: this.network,
      timestamp: new Date(),
      metadata: {
        validatorAddress,
        moniker,
        network: this.network
      }
    };

    await notificationManager.sendAlert(alertPayload);
    logger.info({ validatorAddress, moniker }, 'Validator jailed alert sent');
  }

  /**
   * Validator unjailed bildirimini gönderir
   */
  async sendValidatorUnjailedAlert(validatorAddress: string, moniker: string): Promise<void> {
    const message = `Validator ${moniker} (${validatorAddress}) jailed durumundan çıktı`;

    const alertPayload: AlertPayload = {
      title: 'Validator Unjailed',
      message,
      severity: AlertSeverity.INFO,
      network: this.network,
      timestamp: new Date(),
      metadata: {
        validatorAddress,
        moniker,
        network: this.network
      }
    };

    await notificationManager.sendAlert(alertPayload);
    logger.info({ validatorAddress, moniker }, 'Validator unjailed alert sent');
  }

  /**
   * Validator inaktif (unbonded veya unbonding) bildirimini gönderir
   */
  async sendValidatorInactiveAlert(validatorAddress: string, moniker: string, status: string): Promise<void> {
    const message = `Validator ${moniker} (${validatorAddress}) inaktif duruma geçti: ${status}`;

    const alertPayload: AlertPayload = {
      title: 'Validator Inactive',
      message,
      severity: AlertSeverity.WARNING,
      network: this.network,
      timestamp: new Date(),
      metadata: {
        validatorAddress,
        moniker,
        status,
        network: this.network
      }
    };

    await notificationManager.sendAlert(alertPayload);
    logger.info({ validatorAddress, moniker, status }, 'Validator inactive alert sent');
  }

  /**
   * Validator aktif (bonded) bildirimini gönderir
   */
  async sendValidatorActiveAlert(validatorAddress: string, moniker: string): Promise<void> {
    const message = `Validator ${moniker} (${validatorAddress}) aktif duruma geçti`;

    const alertPayload: AlertPayload = {
      title: 'Validator Active',
      message,
      severity: AlertSeverity.INFO,
      network: this.network,
      timestamp: new Date(),
      metadata: {
        validatorAddress,
        moniker,
        network: this.network
      }
    };

    await notificationManager.sendAlert(alertPayload);
    logger.info({ validatorAddress, moniker }, 'Validator active alert sent');
  }

  /**
   * Gets or creates the alert state for a validator
   */
  private getAlertState(validatorAddress: string): ValidatorAlertState {
    const existingState = this.alertStates.get(validatorAddress);
    if (existingState) return existingState;

    // Create a new alert state
    const newState: ValidatorAlertState = {
      lastAlertedSignatureRate: 0,
      isRecovering: false,
      sentConsecutiveBlocksAlert: false,
      sentUptimeAlert: false
    };

    this.alertStates.set(validatorAddress, newState);
    return newState;
  }

  /**
   * Clear all alert states
   */
  clearAlertStates(): void {
    this.alertStates.clear();
    logger.debug('Validator alert states cleared');
  }
} 