import logger from '../../utils/logger';
import { Network } from '../../config/config';
import { BlockData, ServiceConstants } from './types';
import { CacheManager } from './cache-manager';
import { ValidatorApiClient } from './api-client';

/**
 * Class for processing block data and extracting validator signatures
 */
export class BlockProcessor {
  constructor(
    private readonly apiClient: ValidatorApiClient,
    private readonly cacheManager: CacheManager,
    private readonly constants: ServiceConstants,
    private readonly network: Network,
    private readonly onBlockProcessed: (height: number, signers: Set<string>, timestamp: Date, round: number) => Promise<void>
  ) {}

  /**
   * Normalizes block data from WebSocket
   */
  normalizeBlockData(data: any): BlockData | null {
    try {
      if (!data) return null;

      // WebSocket block comes in Tendermint event format
      if (data.jsonrpc && data.result && data.result.data && data.result.data.value) {
        const blockData = data.result.data.value;
        return {
          block: blockData.block,
          block_id: blockData.block_id
        };
      }

      // Return directly if already in the correct format
      if (data.block) {
        return data;
      }

      logger.warn({ data }, 'Unknown block format');
      return null;
    } catch (error) {
      logger.error({ error, data }, 'Block data normalization error');
      return null;
    }
  }

  /**
   * Checks if a signature flag indicates a commit
   */
  isBlockIdFlagCommit(flag: any): boolean {
    // Numeric check
    if (typeof flag === 'number') {
      return flag === this.constants.BLOCK_ID_FLAG_COMMIT;
    }
    
    // String check
    if (typeof flag === 'string') {
      return flag === this.constants.BLOCK_ID_FLAG_COMMIT_STR || 
             flag === String(this.constants.BLOCK_ID_FLAG_COMMIT);
    }
    
    // If undefined or null, consider unsigned
    return false;
  }

  /**
   * Processes block data from WebSocket and extracts validator signatures
   */
  async processBlockData(blockData: any): Promise<void> {
    if (!blockData) {
      logger.warn('No block data provided for processing');
      return;
    }

    try {
      const normalizedBlock = this.normalizeBlockData(blockData);

      if (!normalizedBlock) {
        logger.warn('No valid block data found for validator signatures');
        return;
      }

      // Extract block information
      const header = normalizedBlock.block.header;
      const lastCommit = normalizedBlock.block.lastCommit || normalizedBlock.block.last_commit;

      if (!header || !lastCommit || !lastCommit.signatures) {
        logger.warn('Required fields not found in block data');
        return;
      }

      const blockHeight = parseInt(header.height, 10);
      const timestamp = new Date(header.time);
      const round = typeof lastCommit.round === 'string' ? parseInt(lastCommit.round, 10) : lastCommit.round;

      logger.info(`Processing block: ${this.network} - ${blockHeight}`);

      // Process signatures
      const signatures = lastCommit.signatures;

      // Add signer addresses to a set
      const signerAddresses = new Set<string>();

      // Process all signatures
      for (const sig of signatures) {
        // Support both camelCase and snake_case
        const validatorAddress = sig.validatorAddress || sig.validator_address || '';
        const blockIdFlag = sig.blockIdFlag || sig.block_id_flag;
        const signed = this.isBlockIdFlagCommit(blockIdFlag);

        if (!validatorAddress || !signed) {
          continue; // Skip empty address or unsigned
        }

        signerAddresses.add(validatorAddress);
      }

      // Cache the votes
      this.cacheManager.cacheVotes(blockHeight, signerAddresses, timestamp, round);

      // Call the callback with the processed data
      await this.onBlockProcessed(blockHeight, signerAddresses, timestamp, round);
    } catch (error) {
      logger.error({
        error,
        blockInfo: blockData ? JSON.stringify(blockData).substring(0, 200) + '...' : 'null',
        network: this.network
      }, 'Error processing block data');
    }
  }
} 