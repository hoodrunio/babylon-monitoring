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
  private trackedValidators: Set<string> = new Set();
  // Default values for alert parameters
  private readonly MIN_ALERT_INTERVAL: number;
  private readonly MIN_RATE_DROP_FOR_ALERT: number;

  constructor(
    private readonly network: Network,
    private readonly options: MonitoringServiceOptions,
  ) {
    // Set notification parameters from config or use defaults
    this.MIN_ALERT_INTERVAL = options.alertMinInterval || 6 * 60 * 60 * 1000; // Default: 6 hours
    this.MIN_RATE_DROP_FOR_ALERT = options.signatureRateMinDrop || 10; // Default: 10%
    
    // Convert tracked validators to Set (for faster search)
    if (options.trackedAddresses && options.trackedAddresses.length > 0) {
      this.trackedValidators = new Set(options.trackedAddresses);
      logger.info({
        trackedAddresses: Array.from(this.trackedValidators),
        count: this.trackedValidators.size
      }, `Tracking specific validators for ${network}`);
    } else {
      logger.info(`No specific validators tracked, will monitor all validators for ${network}`);
    }
  }

  /**
   * Checks if a validator is being tracked
   * If no specific validators are tracked, all validators are considered tracked
   */
  private isTrackedValidator(validatorAddress: string): boolean {
    // If the tracked validator list is empty, track all validators
    if (this.trackedValidators.size === 0) {
      return true;
    }
    
    // Return true only for tracked validators
    return this.trackedValidators.has(validatorAddress);
  }

  /**
   * Checks signature thresholds and sends alerts if necessary
   */
  async checkSignatureThresholds(stats: ValidatorSignatureStats): Promise<void> {
    // If the validator is not being tracked, do not send a notification
    if (!this.isTrackedValidator(stats.validatorAddress)) {
      return;
    }
    
    // Log detailed information about the validator status
    const validatorDisplayName = stats.validator ? stats.validator.moniker : stats.validatorAddress;
    logger.debug({
      validator: validatorDisplayName,
      signatureRate: stats.signatureRate.toFixed(2) + '%',
      threshold: (this.options.validatorSignatureThreshold || 90) + '%',
      consecutiveMissed: stats.consecutiveMissed,
      analyzedBlocks: stats.totalBlocksInWindow,
      network: this.network
    }, `Checking signature thresholds for ${validatorDisplayName}`);
    
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
    const now = new Date();

    // If at least 100 blocks analyzed and signature rate is below threshold
    if (stats.totalBlocksInWindow >= 100 && stats.signatureRate < threshold) {
      const shouldSendAlert = this.shouldSendSignatureRateAlert(alertState, stats.signatureRate, now);
      
      if (shouldSendAlert) {
        await this.sendLowSignatureRateAlert(stats);
        alertState.lastAlertedSignatureRate = stats.signatureRate;
        alertState.lastSignatureRateAlertTime = now;
        alertState.isRecovering = false;
      }
    } else if (stats.totalBlocksInWindow >= 100 && 
               stats.signatureRate >= threshold) {
      // Recovery notification logic
      // If we have recorded a previous alert and we haven't marked recovery yet,
      // or if we are already in recovery state but last alert was long enough ago
      const hasRecentLowRateAlert = alertState.lastAlertedSignatureRate && 
                                   alertState.lastSignatureRateAlertTime;
      
      const timeSinceLastRecoveryAlert = alertState.lastRecoveryAlertTime ? 
        now.getTime() - alertState.lastRecoveryAlertTime.getTime() : 
        this.MIN_ALERT_INTERVAL + 1;
      
      if (hasRecentLowRateAlert && 
         (!alertState.isRecovering || 
          (alertState.isRecovering && timeSinceLastRecoveryAlert > this.MIN_ALERT_INTERVAL))) {
        
        logger.debug({ 
          validatorAddress: stats.validatorAddress, 
          lastAlertedRate: alertState.lastAlertedSignatureRate,
          currentRate: stats.signatureRate,
          isRecovering: alertState.isRecovering,
          timeSinceLastRecovery: timeSinceLastRecoveryAlert
        }, 'Checking recovery notification conditions');
        
        await this.sendSignatureRateRecoveryAlert(stats);
        alertState.isRecovering = true;
        alertState.lastRecoveryAlertTime = now;
      }
    }

    // Update the alert state
    this.alertStates.set(stats.validatorAddress, alertState);
  }

  /**
   * Determines whether to send a signature rate alert based on current conditions
   */
  private shouldSendSignatureRateAlert(alertState: ValidatorAlertState, currentRate: number, now: Date): boolean {
    // If we've never alerted for this validator, or if the rate has dropped significantly since last alert
    if (!alertState.lastAlertedSignatureRate || 
        currentRate <= alertState.lastAlertedSignatureRate - this.MIN_RATE_DROP_FOR_ALERT) {
      
      // Check time since last alert to avoid spamming
      const timeSinceLastAlert = alertState.lastSignatureRateAlertTime ? 
        now.getTime() - alertState.lastSignatureRateAlertTime.getTime() : 
        this.MIN_ALERT_INTERVAL + 1;
      
      // Send alert if it's been long enough since the last one
      return timeSinceLastAlert > this.MIN_ALERT_INTERVAL;
    }
    
    return false;
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
    // Make sure validator is defined before accessing properties
    if (!stats.validator) {
      logger.warn({ validatorAddress: stats.validatorAddress }, 'Cannot send alert: validator info not available');
      return;
    }
    
    const validatorLink = `https://testnet.babylon.hoodscan.io/validators/${stats.validator.operator_address}`;
    
    // Get alert state to include history info
    const alertState = this.getAlertState(stats.validatorAddress);
    const previousRate = alertState.lastAlertedSignatureRate || 0;
    const rateDrop = previousRate > 0 ? (previousRate - stats.signatureRate).toFixed(2) : 'N/A';
    
    // Format the message with more information
    const message = `Validator signature rate has dropped below threshold.

Validator Details:
• Name: ${stats.validator.moniker}
• Address: ${stats.validatorAddress}
• Status: ${stats.validator.status === 'BOND_STATUS_BONDED' ? '✅ Active' : '❌ Inactive'}
• Explorer: [View on Hoodscan](${validatorLink})

Performance:
• Current Rate: ${stats.signatureRate.toFixed(2)}%
• Previous Rate: ${previousRate > 0 ? previousRate.toFixed(2) + '%' : 'N/A'}
• Rate Drop: ${rateDrop}%
• Analyzed Blocks: ${stats.totalBlocksInWindow}
• Threshold: ${this.options.validatorSignatureThreshold || 90}%

Note: Next alert will only be sent after ${this.MIN_RATE_DROP_FOR_ALERT}% further drop or after ${this.MIN_ALERT_INTERVAL / (60 * 60 * 1000)} hours.`;
    
    const alertPayload: AlertPayload = {
      title: `📉 Low Signature Rate | ${stats.validator.moniker}`,
      message: message,
      severity: AlertSeverity.WARNING,
      network: this.network,
      timestamp: new Date(),
      metadata: {
        validatorAddress: stats.validatorAddress,
        validatorOperatorAddress: stats.validator.operator_address,
        validatorMoniker: stats.validator.moniker,
        network: stats.network,
        signatureRate: stats.signatureRate,
        previousRate: previousRate,
        rateDrop: rateDrop,
        totalBlocksInWindow: stats.totalBlocksInWindow,
        validatorLink
      }
    };

    await notificationManager.sendAlert(alertPayload);
    logger.info({ 
      validatorAddress: stats.validatorAddress, 
      rate: stats.signatureRate,
      previousRate,
      rateDrop
    }, 'Low signature rate alert sent');
  }

  /**
   * Sends a signature rate recovery alert
   */
  private async sendSignatureRateRecoveryAlert(stats: ValidatorSignatureStats): Promise<void> {
    // Make sure validator is defined before accessing properties
    if (!stats.validator) {
      logger.warn({ validatorAddress: stats.validatorAddress }, 'Cannot send alert: validator info not available');
      return;
    }
    
    const validatorLink = `https://testnet.babylon.hoodscan.io/validators/${stats.validator.operator_address}`;
    
    // Get alert state to include history info
    const alertState = this.getAlertState(stats.validatorAddress);
    const previousRate = alertState.lastAlertedSignatureRate || 0;
    const rateImprovement = previousRate > 0 ? (stats.signatureRate - previousRate).toFixed(2) : 'N/A';
    
    // Format the message with more information
    const message = `Validator signature rate has recovered above threshold.

Validator Details:
• Name: ${stats.validator.moniker}
• Address: ${stats.validatorAddress}
• Status: ${stats.validator.status === 'BOND_STATUS_BONDED' ? '✅ Active' : '❌ Inactive'}
• Explorer: [View on Hoodscan](${validatorLink})

Performance:
• Current Rate: ${stats.signatureRate.toFixed(2)}%
• Previous Rate: ${previousRate > 0 ? previousRate.toFixed(2) + '%' : 'N/A'}
• Rate Improvement: ${rateImprovement}%
• Analyzed Blocks: ${stats.totalBlocksInWindow}
• Threshold: ${this.options.validatorSignatureThreshold || 90}%`;
    
    const alertPayload: AlertPayload = {
      title: `🔄 Signature Rate Recovering | ${stats.validator.moniker}`,
      message: message,
      severity: AlertSeverity.INFO,
      network: this.network,
      timestamp: new Date(),
      metadata: {
        validatorAddress: stats.validatorAddress,
        validatorOperatorAddress: stats.validator.operator_address,
        validatorMoniker: stats.validator.moniker,
        network: stats.network,
        signatureRate: stats.signatureRate,
        previousRate: previousRate,
        rateImprovement: rateImprovement,
        totalBlocksInWindow: stats.totalBlocksInWindow,
        validatorLink
      }
    };

    await notificationManager.sendAlert(alertPayload);
    logger.info({ 
      validatorAddress: stats.validatorAddress, 
      rate: stats.signatureRate,
      previousRate,
      rateImprovement 
    }, 'Signature rate recovery alert sent');
    
    // Reset the lastAlertedSignatureRate to allow the cycle to repeat if necessary
    alertState.lastAlertedSignatureRate = 0;
    this.alertStates.set(stats.validatorAddress, alertState);
  }

  /**
   * Sends an alert for consecutive missed blocks
   */
  private async sendConsecutiveMissedBlocksAlert(stats: ValidatorSignatureStats): Promise<void> {
    // Make sure validator is defined before accessing properties
    if (!stats.validator) {
      logger.warn({ validatorAddress: stats.validatorAddress }, 'Cannot send alert: validator info not available');
      return;
    }
    
    const validatorLink = `https://testnet.babylon.hoodscan.io/validators/${stats.validator.operator_address}`;
    
    const alertPayload: AlertPayload = {
      title: `⚠️ Consecutive Blocks Missed | ${stats.validator.moniker}`,
      message: `Validator has missed ${stats.consecutiveMissed} consecutive blocks.\n\nValidator Details:\n• Name: ${stats.validator.moniker}\n• Address: ${stats.validatorAddress}\n• Status: ${stats.validator.status === 'BOND_STATUS_BONDED' ? '✅ Active' : '❌ Inactive'}\n• Explorer: [View on Hoodscan](${validatorLink})\n\n⚠️ Please check the node status immediately.`,
      severity: AlertSeverity.CRITICAL,
      network: this.network,
      timestamp: new Date(),
      metadata: {
        validatorAddress: stats.validatorAddress,
        validatorOperatorAddress: stats.validator.operator_address,
        validatorMoniker: stats.validator.moniker,
        network: stats.network,
        consecutiveMissed: stats.consecutiveMissed,
        signatureRate: stats.signatureRate,
        validatorLink
      }
    };

    await notificationManager.sendAlert(alertPayload);
    logger.info({ validatorAddress: stats.validatorAddress, consecutiveMissed: stats.consecutiveMissed }, 'Consecutive missed blocks alert sent');
  }

  /**
   * Sends a validator jailed alert
   */
  async sendValidatorJailedAlert(validatorAddress: string, moniker: string, operatorAddress: string): Promise<void> {
    // If the validator is not being tracked, do not send a notification
    if (!this.isTrackedValidator(validatorAddress)) {
      return;
    }
    
    const validatorLink = `https://testnet.babylon.hoodscan.io/validators/${operatorAddress}`;
    
    const alertPayload: AlertPayload = {
      title: `🔒 Validator Status: Jailed | ${moniker}`,
      message: `Validator has been jailed.\n\nValidator Details:\n• Name: ${moniker}\n• Address: ${validatorAddress}\n• Status Change: ✅ Active → 🔒 Jailed\n• Explorer: [View on Hoodscan](${validatorLink})\n\n⚠️ Immediate action required to restore service.`,
      severity: AlertSeverity.CRITICAL,
      network: this.network,
      timestamp: new Date(),
      metadata: {
        validatorAddress,
        validatorOperatorAddress: operatorAddress,
        validatorMoniker: moniker,
        network: this.network,
        validatorLink
      }
    };

    await notificationManager.sendAlert(alertPayload);
    logger.info({ validatorAddress, moniker }, 'Validator jailed alert sent');
  }

  /**
   * Sends a validator unjailed alert
   */
  async sendValidatorUnjailedAlert(validatorAddress: string, moniker: string, operatorAddress: string): Promise<void> {
    // If the validator is not being tracked, do not send a notification
    if (!this.isTrackedValidator(validatorAddress)) {
      return;
    }
    
    const validatorLink = `https://testnet.babylon.hoodscan.io/validators/${operatorAddress}`;
    
    const alertPayload: AlertPayload = {
      title: `✅ Validator Status: Unjailed | ${moniker}`,
      message: `Validator has been unjailed.\n\nValidator Details:\n• Name: ${moniker}\n• Address: ${validatorAddress}\n• Status Change: 🔒 Jailed → ✅ Active\n• Explorer: [View on Hoodscan](${validatorLink})`,
      severity: AlertSeverity.INFO,
      network: this.network,
      timestamp: new Date(),
      metadata: {
        validatorAddress,
        validatorOperatorAddress: operatorAddress,
        validatorMoniker: moniker,
        network: this.network,
        validatorLink
      }
    };

    await notificationManager.sendAlert(alertPayload);
    logger.info({ validatorAddress, moniker }, 'Validator unjailed alert sent');
  }

  /**
   * Sends a validator inactive (unbonded or unbonding) alert
   */
  async sendValidatorInactiveAlert(validatorAddress: string, moniker: string, status: string, operatorAddress: string): Promise<void> {
    // If the validator is not being tracked, do not send a notification
    if (!this.isTrackedValidator(validatorAddress)) {
      return;
    }
    
    const validatorLink = `https://testnet.babylon.hoodscan.io/validators/${operatorAddress}`;
    
    const alertPayload: AlertPayload = {
      title: `❌ Validator Status: Inactive | ${moniker}`,
      message: `Validator has become inactive.\n\nValidator Details:\n• Name: ${moniker}\n• Address: ${validatorAddress}\n• Current Status: ${status}\n• Explorer: [View on Hoodscan](${validatorLink})`,
      severity: AlertSeverity.WARNING,
      network: this.network,
      timestamp: new Date(),
      metadata: {
        validatorAddress,
        validatorOperatorAddress: operatorAddress,
        validatorMoniker: moniker,
        status,
        network: this.network,
        validatorLink
      }
    };

    await notificationManager.sendAlert(alertPayload);
    logger.info({ validatorAddress, moniker, status }, 'Validator inactive alert sent');
  }

  /**
   * Sends a validator active (bonded) alert
   */
  async sendValidatorActiveAlert(validatorAddress: string, moniker: string, operatorAddress: string): Promise<void> {
    // If the validator is not being tracked, do not send a notification
    if (!this.isTrackedValidator(validatorAddress)) {
      return;
    }
    
    const validatorLink = `https://testnet.babylon.hoodscan.io/validators/${operatorAddress}`;
    
    const alertPayload: AlertPayload = {
      title: `✅ Validator Status: Active | ${moniker}`,
      message: `Validator has become active (bonded).\n\nValidator Details:\n• Name: ${moniker}\n• Address: ${validatorAddress}\n• Status: Bonded\n• Explorer: [View on Hoodscan](${validatorLink})`,
      severity: AlertSeverity.INFO,
      network: this.network,
      timestamp: new Date(),
      metadata: {
        validatorAddress,
        validatorOperatorAddress: operatorAddress,
        validatorMoniker: moniker,
        network: this.network,
        validatorLink
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
      lastSignatureRateAlertTime: undefined,
      lastRecoveryAlertTime: undefined,
      isRecovering: false,
      sentConsecutiveBlocksAlert: false,
      sentUptimeAlert: false,
      lastCriticalAlertTime: undefined
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