import logger from '../../utils/logger';
import { Network } from '../../config/config';
import { MonitoringServiceOptions } from '../monitoring-service.interface';
import { BLSValidatorSignature, BLSCheckpointStats } from '../../models/bls-signature.model';
import notificationManager from '../../notifiers/notification-manager';
import { AlertPayload, AlertSeverity } from '../../notifiers/notifier.interface';

/**
 * Interface for tracking BLS validator alert state
 */
export interface BLSAlertState {
  lastMissedEpoch?: number;
  sentAlert: boolean;
  isRecovering: boolean;
  lastAlertTime?: Date;
  lastRecoveryAlertTime?: Date;
}

/**
 * Class for handling BLS signature notifications and alerts
 */
export class NotificationService {
  // Tracks the notification status for each validator
  private alertStates: Map<string, BLSAlertState> = new Map();
  
  constructor(
    private readonly network: Network,
    private readonly options: MonitoringServiceOptions
  ) {}

  /**
   * Gets or creates an alert state for a validator
   */
  private getAlertState(validatorAddress: string): BLSAlertState {
    if (!this.alertStates.has(validatorAddress)) {
      this.alertStates.set(validatorAddress, {
        sentAlert: false,
        isRecovering: false
      });
    }
    return this.alertStates.get(validatorAddress)!;
  }

  /**
   * Checks tracked validators and sends alerts
   */
  async checkTrackedValidators(epochNum: number, signatures: BLSValidatorSignature[]): Promise<void> {
    // If tracked validators are specified
    if (this.options.trackedAddresses && this.options.trackedAddresses.length > 0) {
      for (const signature of signatures) {
        // Is this validator being tracked?
        const isTracked = this.options.trackedAddresses.some((addr: string) => 
          addr === signature.validatorAddress || addr === signature.validatorOperatorAddress
        );
        
        if (isTracked) {
          const alertState = this.getAlertState(signature.validatorAddress);
          
          if (!signature.signed) {
            // Send an alert for an unsigned BLS checkpoint
            await this.sendMissedBLSSignatureAlert(signature);
            
            // Update alert state
            alertState.sentAlert = true;
            alertState.lastMissedEpoch = epochNum;
            alertState.lastAlertTime = new Date();
            alertState.isRecovering = false;
          } else if (alertState.sentAlert && !alertState.isRecovering) {
            // Recovery detection - validator has signed this epoch after missing a previous one
            // We no longer require it to be the immediately following epoch
            
            if (alertState.lastMissedEpoch !== undefined) {
              // Only if we have a record of a missed epoch
              await this.sendBLSSignatureRecoveryAlert(signature);
              
              // Update alert state
              alertState.isRecovering = true;
              alertState.lastRecoveryAlertTime = new Date();
            }
          }
          
          // Update the alert state
          this.alertStates.set(signature.validatorAddress, alertState);
        }
      }
    }
  }

  /**
   * Checks for low participation rate and sends alerts
   */
  async checkParticipationRate(stats: BLSCheckpointStats): Promise<void> {
    const threshold = this.options.blockThreshold || 90;
    const participationRateByPower = parseFloat(stats.participationRateByPower);
    
    if (participationRateByPower < threshold) {
      await this.sendLowParticipationAlert(stats);
    }
  }

  /**
   * Sends an alert for a missed BLS signature
   */
  private async sendMissedBLSSignatureAlert(signature: BLSValidatorSignature): Promise<void> {
    const validatorLink = `https://testnet.babylon.hoodscan.io/validators/${signature.validatorOperatorAddress}`;
    
    const alert: AlertPayload = {
      title: `⚠️ BLS Signature Missing | ${signature.validatorMoniker}`,
      message: `Validator ${signature.validatorMoniker} missed BLS checkpoint signature for Epoch ${signature.epochNum}.\n\nValidator Details:\n• Address: ${signature.validatorOperatorAddress}\n• Power: ${signature.validatorPower}\n• Explorer: [View on Hoodscan](${validatorLink})`,
      severity: AlertSeverity.CRITICAL,
      network: this.network,
      timestamp: new Date(),
      metadata: {
        validatorAddress: signature.validatorAddress,
        validatorMoniker: signature.validatorMoniker,
        operatorAddress: signature.validatorOperatorAddress,
        epoch: signature.epochNum,
        power: signature.validatorPower,
        validatorLink
      }
    };
    
    await notificationManager.sendAlert(alert);
    logger.info({
      validatorAddress: signature.validatorAddress,
      validatorMoniker: signature.validatorMoniker,
      epochNum: signature.epochNum,
      network: this.network
    }, 'Missed BLS signature alert sent');
  }

  /**
   * Sends a recovery alert when validator signs after missing
   */
  private async sendBLSSignatureRecoveryAlert(signature: BLSValidatorSignature): Promise<void> {
    const validatorLink = `https://testnet.babylon.hoodscan.io/validators/${signature.validatorOperatorAddress}`;
    
    const alert: AlertPayload = {
      title: `🔄 BLS Signature Recovered | ${signature.validatorMoniker}`,
      message: `Validator ${signature.validatorMoniker} has recovered and signed BLS checkpoint for Epoch ${signature.epochNum}.\n\nValidator Details:\n• Address: ${signature.validatorOperatorAddress}\n• Power: ${signature.validatorPower}\n• Explorer: [View on Hoodscan](${validatorLink})`,
      severity: AlertSeverity.INFO,
      network: this.network,
      timestamp: new Date(),
      metadata: {
        validatorAddress: signature.validatorAddress,
        validatorMoniker: signature.validatorMoniker,
        operatorAddress: signature.validatorOperatorAddress,
        epoch: signature.epochNum,
        power: signature.validatorPower,
        validatorLink
      }
    };
    
    await notificationManager.sendAlert(alert);
    logger.info({
      validatorAddress: signature.validatorAddress,
      validatorMoniker: signature.validatorMoniker,
      epochNum: signature.epochNum,
      network: this.network
    }, 'BLS signature recovery alert sent');
  }

  /**
   * Sends an alert for low checkpoint participation rate
   */
  private async sendLowParticipationAlert(stats: BLSCheckpointStats): Promise<void> {
    const activeValidators = stats.totalValidators - Math.floor((parseInt(stats.totalPower) - parseInt(stats.signedPower)) / parseInt(stats.totalPower) * stats.totalValidators);
    
    const alert: AlertPayload = {
      title: `🔍 Low BLS Checkpoint Participation | Epoch ${stats.epochNum}`,
      message: `Low participation detected in BLS checkpoint for Epoch ${stats.epochNum}.\n\nParticipation Stats:\n• By Power: ${stats.participationRateByPower}\n• By Validator Count: ${stats.participationRateByCount}\n• Signed Power: ${stats.signedPower}/${stats.totalPower}\n• Active Validators: ${activeValidators}/${stats.totalValidators}`,
      severity: AlertSeverity.WARNING,
      network: this.network,
      timestamp: new Date(),
      metadata: {
        epoch: stats.epochNum,
        totalValidators: stats.totalValidators,
        totalPower: stats.totalPower,
        signedPower: stats.signedPower,
        unsignedPower: stats.unsignedPower,
        participationRateByCount: stats.participationRateByCount,
        participationRateByPower: stats.participationRateByPower
      }
    };
    
    await notificationManager.sendAlert(alert);
    logger.info({
      epochNum: stats.epochNum,
      participationRateByPower: stats.participationRateByPower,
      participationRateByCount: stats.participationRateByCount,
      network: this.network
    }, 'Low BLS checkpoint participation rate alert sent');
  }
} 