import logger from '../../utils/logger';
import { Network } from '../../config/config';
import { MonitoringServiceOptions } from '../monitoring-service.interface';
import { BLSValidatorSignature, BLSCheckpointStats } from '../../models/bls-signature.model';
import notificationManager from '../../notifiers/notification-manager';
import { AlertPayload, AlertSeverity } from '../../notifiers/notifier.interface';

/**
 * Class for handling BLS signature notifications and alerts
 */
export class NotificationService {
  constructor(
    private readonly network: Network,
    private readonly options: MonitoringServiceOptions
  ) {}

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
        
        if (isTracked && !signature.signed) {
          // Send an alert for an unsigned BLS checkpoint
          await this.sendMissedBLSSignatureAlert(signature);
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