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
    const alert: AlertPayload = {
      title: `Validator Missed BLS Signature: ${signature.validatorMoniker}`,
      message: `Validator ${signature.validatorMoniker} (${signature.validatorOperatorAddress}) BLS checkpoint signature not found for Epoch ${signature.epochNum}.`,
      severity: AlertSeverity.CRITICAL,
      network: this.network,
      timestamp: new Date(),
      metadata: {
        validatorAddress: signature.validatorAddress,
        validatorMoniker: signature.validatorMoniker,
        operatorAddress: signature.validatorOperatorAddress,
        epoch: signature.epochNum,
        power: signature.validatorPower
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
    const alert: AlertPayload = {
      title: `Low BLS Checkpoint Participation Rate: Epoch ${stats.epochNum}`,
      message: `Low BLS checkpoint participation rate for Epoch ${stats.epochNum}. By Power: ${stats.participationRateByPower}, By Validator Count: ${stats.participationRateByCount}`,
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