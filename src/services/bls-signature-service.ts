import { BabylonClient } from '../clients/babylon-client.interface';
import { MonitoringService, MonitoringServiceOptions } from './monitoring-service.interface';
import { Network } from '../config/config';
import logger from '../utils/logger';
import { BLSValidatorSignature, BLSCheckpointStats } from '../models/bls-signature.model';
import blsSignatureRepository from '../database/repositories/bls-signature.repository';
import notificationManager from '../notifiers/notification-manager';
import { AlertPayload, AlertSeverity } from '../notifiers/notifier.interface';

interface EpochResponse {
  current_epoch: string;
  epoch_boundary: string;
}

interface BlockTransactionsResponse {
  txs: Array<{
    body: {
      messages: Array<{
        '@type': string;
        extended_commit_info?: {
          votes: Array<{
            validator: {
              address: string;
              power: string;
            };
            vote_extension?: string;
            extension_signature?: string;
            block_id_flag: string;
          }>;
        };
        ckpt?: {
          ckpt: {
            epoch_num: string;
            block_hash: string;
            bitmap: string;
            bls_multi_sig: string;
          };
          status: string;
          bls_aggr_pk: string;
          power_sum: string;
          lifecycle: any[];
        };
      }>;
      memo: string;
      timeout_height: string;
      extension_options: any[];
      non_critical_extension_options: any[];
    };
    auth_info: any;
    signatures: any[];
  }>;
}

interface ValidatorResponse {
  validators: Array<{
    operator_address: string;
    consensus_pubkey: {
      key: string;
    };
    description: {
      moniker: string;
    };
    status: string;
    voting_power: string;
  }>;
  pagination: {
    total: string;
  };
}

// BLS signatures are found in checkpoints created at the end of each epoch
export class BLSSignatureService implements MonitoringService {
  private client: BabylonClient | null = null;
  private options: MonitoringServiceOptions | null = null;
  private validatorInfoMap: Map<string, { moniker: string, operatorAddress: string, power: string }> = new Map();
  private currentEpoch = 0;
  private epochCheckpoints: Set<number> = new Set(); // Processed checkpoints
  private readonly EPOCH_BLOCKS = 360; // Number of blocks in an epoch

  async initialize(client: BabylonClient, options: MonitoringServiceOptions): Promise<void> {
    this.client = client;
    this.options = options;

    if (!options.enabled) {
      logger.info(`BLSSignatureService is disabled for the ${options.network} network`);
      return;
    }

    logger.info(`BLSSignatureService is starting for the ${options.network} network`);
    
    try {
      // Initialize the repository
      await blsSignatureRepository.initialize();
      
      // Load validator information
      await this.loadValidatorInfo();
      
      // Fetch the current epoch
      await this.fetchCurrentEpoch();
      
      logger.info(`BLSSignatureService started for the ${options.network} network, current epoch: ${this.currentEpoch}`);
    } catch (error) {
      logger.error({ error }, `BLSSignatureService initialization error (${options.network})`);
      throw error;
    }
  }

  async start(): Promise<void> {
    if (!this.isEnabled()) return;
    logger.info(`BLSSignatureService started for the ${this.getNetwork()} network`);
  }

  async stop(): Promise<void> {
    logger.info(`BLSSignatureService stopped for the ${this.getNetwork()} network`);
  }

  async handleNewBlock(height: number): Promise<void> {
    if (!this.isEnabled() || !this.client) return;

    try {
      // Only used to update the current epoch
      if (height % 50 === 0) {
        await this.fetchCurrentEpoch();
      }
      
      // BLS checkpoints will be processed in the callback called when a checkpoint event arrives via WebSocket
      // This method will no longer directly search for BLS checkpoints
    } catch (error) {
      logger.error({ error, height }, 'BLS epoch update error');
    }
  }

  // New method to be called by the WebSocket callback
  async handleBLSCheckpoint(epochNum: number): Promise<void> {
    if (!this.isEnabled() || !this.client) return;
    
    try {
      logger.info(`Processing BLS checkpoint for epoch ${epochNum}`);
      
      // If it has already been processed, skip it
      if (this.epochCheckpoints.has(epochNum)) {
        logger.info(`BLS checkpoint for epoch ${epochNum} has already been processed, skipping`);
        return;
      }
      
      // Calculate the block height for the checkpoint
      const epochLength = this.EPOCH_BLOCKS;
      const epochBoundary = epochNum * epochLength;
      const targetHeight = epochBoundary + 1; // Checkpoint is usually at the end of the epoch + 1 block
      
      // Check for transactions at this height
      await this.checkForBLSCheckpoint(targetHeight, epochNum);
      
      // If not found, also check blocks +2, +3, +4, +5
      if (!this.epochCheckpoints.has(epochNum)) {
        for (let i = 2; i <= 5; i++) {
          if (!this.epochCheckpoints.has(epochNum)) {
            await this.checkForBLSCheckpoint(epochBoundary + i, epochNum);
          }
        }
      }
      
      // Warning log if still not found
      if (!this.epochCheckpoints.has(epochNum)) {
        logger.warn(`BLS checkpoint not found for epoch ${epochNum}`);
      }
    } catch (error) {
      logger.error({ error, epochNum }, 'BLS checkpoint processing error');
    }
  }

  private async fetchCurrentEpoch(): Promise<void> {
    if (!this.client) throw new Error('BabylonClient not initialized');
    
    try {
      const response = await this.client.makeRestRequest<EpochResponse>(
        '/babylon/epoching/v1/current_epoch'
      );
      
      // Use the current_epoch field (according to the actual correct API response)
      const newEpoch = parseInt(response.current_epoch);
      
      if (!isNaN(newEpoch) && newEpoch !== this.currentEpoch) {
        logger.info(`New epoch: ${newEpoch}, previous: ${this.currentEpoch}`);
        this.currentEpoch = newEpoch;
      } else if (isNaN(newEpoch)) {
        logger.warn(`Epoch value is not a number: ${response.current_epoch}`);
      }
    } catch (error) {
      logger.error({ error }, 'Error getting current epoch information');
    }
  }

  private async checkForBLSCheckpoint(height: number, epochNum: number): Promise<void> {
    if (!this.client) throw new Error('BabylonClient not initialized');
    
    try {
      // Get transactions in the block
      const transactions = await this.getTransactionsAtHeight(height);
      
      if (!transactions || !transactions.txs || transactions.txs.length === 0) {
        return;
      }
      
      // Search for checkpoint messages
      for (const tx of transactions.txs) {
        if (!tx.body || !tx.body.messages) continue;
        
        // Find checkpoint messages
        for (const msg of tx.body.messages) {
          // Check the BLS checkpoint type
          if (msg['@type'] === '/babylon.checkpointing.v1.MsgInjectedCheckpoint' && msg.extended_commit_info) {
            logger.info(`BLS checkpoint found for epoch ${epochNum}, height: ${height}`);
            
            // Process the checkpoint
            await this.processCheckpoint(epochNum, msg.extended_commit_info, msg.ckpt);
            
            // Mark this epoch as processed
            this.epochCheckpoints.add(epochNum);
            
            // No need to check other transactions
            return;
          }
        }
      }
    } catch (error) {
      logger.error({ error, height, epochNum }, 'BLS checkpoint check error');
    }
  }

  private async processCheckpoint(epochNum: number, extendedCommitInfo: any, ckptInfo?: any): Promise<void> {
    try {
      // Warn and exit if the votes field is missing
      if (!extendedCommitInfo.votes) {
        logger.warn({ epochNum }, 'BLS checkpoint votes field not found');
        return;
      }
      
      // If the value from the epochNum parameter and the epoch_num inside ckptInfo are different, use the value from ckptInfo
      if (ckptInfo && ckptInfo.ckpt && ckptInfo.ckpt.epoch_num) {
        epochNum = parseInt(ckptInfo.ckpt.epoch_num, 10);
      }
      
      const votes = extendedCommitInfo.votes;
      const validatorSignatures: BLSValidatorSignature[] = [];
      let totalPower = 0;
      let signedPower = 0;
      
      // Process all validator votes
      for (const vote of votes) {
        // Get validator information - According to the example JSON structure, validator information is now inside vote.validator
        const validatorAddress = vote.validator.address;
        const validatorPower = vote.validator.power;
        
        // You can convert the base64 value to hex to get information from validatorInfoMap
        // Or update the loadValidatorInfo method to populate validatorInfoMap with base64 addresses
        const validatorInfo = this.validatorInfoMap.get(validatorAddress);
        
        if (!validatorInfo) {
          // If validator information is not in the map, continue with the information in the vote
          logger.debug(`Validator information not found: ${validatorAddress}`);
          continue;
        }
        
        // Check the vote value
        // The BLOCK_ID_FLAG_COMMIT value comes as a string instead of an enum: "BLOCK_ID_FLAG_COMMIT"
        const signed = vote.block_id_flag === "BLOCK_ID_FLAG_COMMIT" && !!vote.extension_signature;
        
        // Convert validator power to numbers
        const powerValue = parseInt(validatorPower, 10);
        
        // Calculate total power
        totalPower += powerValue;
        
        // Add to signed power if signed
        if (signed) {
          signedPower += powerValue;
        }
        
        // Create BLS signature data
        const signature: BLSValidatorSignature = {
          epochNum,
          validatorAddress,
          validatorMoniker: validatorInfo.moniker,
          validatorOperatorAddress: validatorInfo.operatorAddress,
          validatorPower: validatorPower,
          signed,
          voteExtension: vote.vote_extension,
          extensionSignature: vote.extension_signature,
          network: this.getNetwork(),
          timestamp: new Date()
        };
        
        validatorSignatures.push(signature);
        
        // Save to the database
        await blsSignatureRepository.saveSignature(signature);
      }
      
      // Create BLS checkpoint statistics
      const totalValidators = validatorSignatures.length;
      const signedValidators = validatorSignatures.filter(v => v.signed).length;
      
      const stats: BLSCheckpointStats = {
        epochNum,
        network: this.getNetwork(),
        totalValidators,
        totalPower: totalPower.toString(),
        signedPower: signedPower.toString(),
        unsignedPower: (totalPower - signedPower).toString(),
        participationRateByCount: ((signedValidators / totalValidators) * 100).toFixed(2) + '%',
        participationRateByPower: ((signedPower / totalPower) * 100).toFixed(2) + '%',
        timestamp: new Date()
      };
      
      // Save checkpoint statistics
      await blsSignatureRepository.saveCheckpointStats(stats);
      
      // Check for tracked validators and send alerts
      await this.checkTrackedValidators(epochNum, validatorSignatures);
      
      // Send a general alert if the participation rate is low
      const participationRateByPower = (signedPower / totalPower) * 100;
      if (participationRateByPower < (this.options?.blockThreshold || 90)) {
        await this.sendLowParticipationAlert(stats);
      }
      
      logger.info({
        epochNum,
        totalValidators,
        signedValidators,
        participationByCount: stats.participationRateByCount,
        participationByPower: stats.participationRateByPower
      }, 'BLS checkpoint statistics calculated');
    } catch (error) {
      logger.error({ error, epochNum }, 'BLS checkpoint processing error');
    }
  }

  private async checkTrackedValidators(epochNum: number, signatures: BLSValidatorSignature[]): Promise<void> {
    // If tracked validators are specified
    if (this.options?.trackedAddresses && this.options.trackedAddresses.length > 0) {
      for (const signature of signatures) {
        // Is this validator being tracked?
        const isTracked = this.options.trackedAddresses.some(addr => 
          addr === signature.validatorAddress || addr === signature.validatorOperatorAddress
        );
        
        if (isTracked && !signature.signed) {
          // Send an alert for an unsigned BLS checkpoint
          await this.sendMissedBLSSignatureAlert(signature);
        }
      }
    }
  }

  private async sendMissedBLSSignatureAlert(signature: BLSValidatorSignature): Promise<void> {
    const alert: AlertPayload = {
      title: `Validator Missed BLS Signature: ${signature.validatorMoniker}`,
      message: `Validator ${signature.validatorMoniker} (${signature.validatorOperatorAddress}) BLS checkpoint signature not found for Epoch ${signature.epochNum}.`,
      severity: AlertSeverity.CRITICAL,
      network: this.getNetwork(),
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
  }

  private async sendLowParticipationAlert(stats: BLSCheckpointStats): Promise<void> {
    const alert: AlertPayload = {
      title: `Low BLS Checkpoint Participation Rate: Epoch ${stats.epochNum}`,
      message: `Low BLS checkpoint participation rate for Epoch ${stats.epochNum}. By Power: ${stats.participationRateByPower}, By Validator Count: ${stats.participationRateByCount}`,
      severity: AlertSeverity.WARNING,
      network: this.getNetwork(),
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
  }

  private async loadValidatorInfo(): Promise<void> {
    try {
      const validators = await this.getValidators();
      
      this.validatorInfoMap.clear();
      
      for (const validator of validators) {
        const consensusKey = validator.consensus_pubkey.key;
        const validatorAddress = this.pubkeyToAddress(consensusKey);
        
        this.validatorInfoMap.set(validatorAddress, {
          moniker: validator.description.moniker,
          operatorAddress: validator.operator_address,
          power: validator.voting_power
        });
      }
      
      logger.info(`${validators.length} validators loaded for BLS signature monitoring (${this.getNetwork()})`);
    } catch (error) {
      logger.error({ error }, 'Error loading validator information');
      throw error;
    }
  }

  private async getTransactionsAtHeight(height: number): Promise<BlockTransactionsResponse> {
    if (!this.client) throw new Error('BabylonClient not initialized');
    
    try {
      // We are getting block transactions directly instead of /cosmos/tx/v1beta1/txs/block
      // A different endpoint may be used in the actual implementation
      return await this.client.makeRestRequest<BlockTransactionsResponse>(
        `/cosmos/tx/v1beta1/txs/block/${height}`
      );
    } catch (error) {
      logger.error({ error, height }, 'Error getting block transactions');
      throw error;
    }
  }

  private async getValidators(): Promise<ValidatorResponse['validators']> {
    if (!this.client) throw new Error('BabylonClient not initialized');
    
    try {
      const response = await this.client.makeRestRequest<ValidatorResponse>(
        '/cosmos/staking/v1beta1/validators',
        { 'pagination.limit': 1000 }
      );
      return response.validators;
    } catch (error) {
      logger.error({ error }, 'Error getting validators');
      throw error;
    }
  }

  private pubkeyToAddress(pubkey: string): string {
    // This is an example implementation. In a real application, hash and encoding operations are required
    // to obtain the address from the consensus pubkey.
    return pubkey;
  }

  isEnabled(): boolean {
    return this.options?.enabled === true;
  }

  getName(): string {
    return 'BLSSignatureService';
  }

  getNetwork(): Network {
    return this.options?.network || Network.MAINNET;
  }
} 