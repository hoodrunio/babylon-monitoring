import logger from '../../utils/logger';
import { Network } from '../../config/config';
import { BLSValidatorSignature, BLSCheckpointStats } from '../../models/bls-signature.model';
import { BLSApiClient } from './api-client';
import { ValidatorManager } from './validator-manager';
import { EpochManager } from './epoch-manager';
import { ServiceConstants } from './types';

/**
 * Class for processing BLS checkpoints
 */
export class CheckpointProcessor {
  constructor(
    private readonly apiClient: BLSApiClient,
    private readonly validatorManager: ValidatorManager,
    private readonly epochManager: EpochManager,
    private readonly constants: ServiceConstants,
    private readonly network: Network,
    private readonly onCheckpointProcessed: (
      epochNum: number, 
      signatures: BLSValidatorSignature[], 
      stats: BLSCheckpointStats
    ) => Promise<void>
  ) {}

  /**
   * Processes a BLS checkpoint for a specific epoch
   */
  async processCheckpoint(epochNum: number): Promise<void> {
    try {
      logger.info(`Processing BLS checkpoint for epoch ${epochNum} (${this.network})`);
      
      // If it has already been processed, skip it
      if (this.epochManager.isEpochProcessed(epochNum)) {
        logger.info(`BLS checkpoint for epoch ${epochNum} has already been processed, skipping`);
        return;
      }
      
      // Calculate the block height for the checkpoint
      const targetHeight = this.epochManager.calculateCheckpointHeight(epochNum);
      
      // Check for transactions at this height
      await this.searchForCheckpoint(targetHeight, epochNum);
      
      // If not found, also check blocks +2, +3, +4, +5
      if (!this.epochManager.isEpochProcessed(epochNum)) {
        for (let i = 2; i <= 5; i++) {
          if (!this.epochManager.isEpochProcessed(epochNum)) {
            await this.searchForCheckpoint(targetHeight + i - 1, epochNum);
          }
        }
      }
      
      // Warning log if still not found
      if (!this.epochManager.isEpochProcessed(epochNum)) {
        logger.warn(`BLS checkpoint not found for epoch ${epochNum} (${this.network})`);
      }
    } catch (error) {
      logger.error({ error, epochNum, network: this.network }, 'BLS checkpoint processing error');
    }
  }

  /**
   * Searches for a checkpoint transaction in a block at a specific height
   */
  private async searchForCheckpoint(height: number, epochNum: number): Promise<void> {
    try {
      // Get transactions in the block
      const transactions = await this.apiClient.getTransactionsAtHeight(height);
      
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
            logger.info(`BLS checkpoint found for epoch ${epochNum}, height: ${height} (${this.network})`);
            
            // Process the checkpoint
            await this.extractCheckpointData(epochNum, msg.extended_commit_info, msg.ckpt);
            
            // Mark this epoch as processed
            this.epochManager.markEpochProcessed(epochNum);
            
            // No need to check other transactions
            return;
          }
        }
      }
    } catch (error) {
      logger.error({ error, height, epochNum, network: this.network }, 'BLS checkpoint search error');
    }
  }

  /**
   * Extracts and processes checkpoint data
   */
  private async extractCheckpointData(epochNum: number, extendedCommitInfo: any, ckptInfo?: any): Promise<void> {
    try {
      // Warn and exit if the votes field is missing
      if (!extendedCommitInfo.votes) {
        logger.warn({ epochNum, network: this.network }, 'BLS checkpoint votes field not found');
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
        // Get validator information - validator information is inside vote.validator
        const validatorAddress = vote.validator.address;
        const validatorPower = vote.validator.power;
        
        // Get validator details from manager
        const validatorInfo = this.validatorManager.getValidatorInfo(validatorAddress);
        
        // Determine if signature is valid
        const signed = vote.block_id_flag === this.constants.BLOCK_ID_FLAG_COMMIT_STR && !!vote.extension_signature;
        
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
          validatorMoniker: validatorInfo ? validatorInfo.moniker : 'Unknown',
          validatorOperatorAddress: validatorInfo ? validatorInfo.operatorAddress : 'Unknown',
          validatorPower: validatorPower,
          signed,
          voteExtension: vote.vote_extension,
          extensionSignature: vote.extension_signature,
          network: this.network,
          timestamp: new Date()
        };
        
        validatorSignatures.push(signature);
      }
      
      // Create BLS checkpoint statistics
      const totalValidators = validatorSignatures.length;
      const signedValidators = validatorSignatures.filter(v => v.signed).length;
      
      const stats: BLSCheckpointStats = {
        epochNum,
        network: this.network,
        totalValidators,
        totalPower: totalPower.toString(),
        signedPower: signedPower.toString(),
        unsignedPower: (totalPower - signedPower).toString(),
        participationRateByCount: ((signedValidators / totalValidators) * 100).toFixed(2) + '%',
        participationRateByPower: ((signedPower / totalPower) * 100).toFixed(2) + '%',
        timestamp: new Date()
      };
      
      // Call the callback with the processed data
      await this.onCheckpointProcessed(epochNum, validatorSignatures, stats);
      
      logger.info({
        epochNum,
        network: this.network,
        totalValidators,
        signedValidators,
        participationByCount: stats.participationRateByCount,
        participationByPower: stats.participationRateByPower
      }, 'BLS checkpoint statistics calculated');
    } catch (error) {
      logger.error({ error, epochNum, network: this.network }, 'BLS checkpoint data extraction error');
    }
  }
} 