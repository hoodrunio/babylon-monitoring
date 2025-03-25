import { BabylonClient } from '../clients/babylon-client.interface';
import { MonitoringService, MonitoringServiceOptions } from './monitoring-service.interface';
import { Network } from '../config/config';
import logger from '../utils/logger';
import { ValidatorSignatureStats } from '../models/validator-signature.model';
import validatorSignatureRepository from '../database/repositories/validator-signature.repository';
import notificationManager from '../notifiers/notification-manager';
import { AlertPayload, AlertSeverity } from '../notifiers/notifier.interface';
import validatorInfoService from './validator-info-service';
import { ValidatorInfo } from '../models/validator-info.model';

// Extend MonitoringServiceOptions interface
declare module './monitoring-service.interface' {
  interface MonitoringServiceOptions {
    trackMissedSignatures?: boolean;
    validatorSignatureThreshold?: number;
  }
}

interface BlockData {
  block: {
    header: {
      height: string;
      time: string;
      proposer_address?: string;
      proposerAddress?: string;
    };
    last_commit?: {
      height: string;
      round: number | string;
      signatures: Array<BlockSignature>;
    };
    lastCommit?: {
      height: string;
      round: number | string;
      signatures: Array<BlockSignature>;
    };
  };
  block_id?: {
    hash: string;
  };
  blockId?: {
    hash: string;
  };
}

interface BlockSignature {
  block_id_flag?: number | string;
  blockIdFlag?: number | string;
  validator_address?: string;
  validatorAddress?: string;
  timestamp: string;
  signature: string | null;
}

export class ValidatorSignatureService implements MonitoringService {
  private client: BabylonClient | null = null;
  private options: MonitoringServiceOptions | null = null;
  private validatorInfoCache: Map<string, ValidatorInfo> = new Map();
  private readonly BLOCK_ID_FLAG_COMMIT = 2; // Signature flag
  private readonly BLOCK_ID_FLAG_COMMIT_STR = "BLOCK_ID_FLAG_COMMIT"; // COMMIT flag as string
  private readonly RECENT_BLOCKS_LIMIT = 100; // Limit for recent blocks
  private readonly SIGNATURE_PERFORMANCE_WINDOW = 10000; // Performance window

  async initialize(client: BabylonClient, options: MonitoringServiceOptions): Promise<void> {
    this.client = client;
    this.options = options;

    if (!options.enabled) {
      logger.info(`ValidatorSignatureService disabled for ${options.network} network`);
      return;
    }

    logger.info(`Initializing ValidatorSignatureService for ${options.network} network`);

    try {
      // Initialize validator repository
      await validatorSignatureRepository.initialize();

      // Load validator information
      await this.loadValidatorInfo();

      logger.info(`ValidatorSignatureService initialized for ${options.network} network`);
    } catch (error) {
      logger.error({ error }, `ValidatorSignatureService initialization error (${options.network})`);
      throw error;
    }
  }

  async start(): Promise<void> {
    if (!this.isEnabled()) return;
    logger.info(`ValidatorSignatureService started for ${this.getNetwork()} network`);
  }

  async stop(): Promise<void> {
    logger.info(`ValidatorSignatureService stopped for ${this.getNetwork()} network`);
  }

  /**
   * Called when a new block arrives from the blockchain.
   * This method is required for the MonitoringService interface.
   */
  async handleNewBlock(height: number): Promise<void> {
    if (!this.isEnabled()) return;
    logger.info(`New block reported: ${this.getNetwork()} - ${height}`);
    // This method no longer makes any REST API calls.
    // The handleWebSocketBlock method should be used when new block data arrives via WebSocketManager.
  }

  /**
   * Processes block data from WebSocket.
   */
  async handleWebSocketBlock(blockData: any): Promise<void> {
    if (!this.isEnabled()) return;

    try {
      const normalizedBlock = this.normalizeWebSocketBlockData(blockData);

      if (!normalizedBlock) {
        logger.warn('No valid block data found for validator signatures.');
        return;
      }

      // Extract block information.
      const header = normalizedBlock.block.header;
      const lastCommit = normalizedBlock.block.lastCommit || normalizedBlock.block.last_commit;

      if (!header || !lastCommit || !lastCommit.signatures) {
        logger.warn('Required fields not found in block data.');
        return;
      }

      const blockHeight = parseInt(header.height, 10);
      const timestamp = new Date(header.time);
      const round = typeof lastCommit.round === 'string' ? parseInt(lastCommit.round, 10) : lastCommit.round;

      logger.info(`Processing WebSocket block: ${this.getNetwork()} - ${blockHeight}`);

      // Process signatures.
      const signatures = lastCommit.signatures;

      // Add signer addresses to a set.
      const signerAddresses = new Set<string>();

      // Process all signatures first.
      for (const sig of signatures) {
        // Support both camelCase and snake_case.
        const validatorAddress = sig.validatorAddress || sig.validator_address || '';
        const blockIdFlag = sig.blockIdFlag || sig.block_id_flag;
        const signed = this.isBlockIdFlagCommit(blockIdFlag);

        if (!validatorAddress) {
          logger.debug({
            blockHeight,
            blockIdFlag,
            signaturePresent: !!sig.signature
          }, 'Empty validator address, skipping signature.');
          continue; // Skip empty address.
        }

        if (!signed) {
          logger.debug({
            blockHeight,
            validatorAddress,
            blockIdFlag
          }, 'Unsigned block, skipping.');
          continue; // Skip unsigned.
        }

        try {
          // Get validator information.
          const validatorInfo = await this.getValidatorInfo(validatorAddress);

          if (!validatorInfo) {
            logger.warn({
              blockHeight,
              validatorAddress
            }, 'Validator information not found, skipping signature.');
            continue;
          }

          if (!validatorInfo.operator_address) {
            logger.warn({
              blockHeight,
              validatorAddress,
              validatorMoniker: validatorInfo.moniker || 'unknown'
            }, 'Missing validator address information, skipping signature.');
            continue;
          }

          // Add signer addresses to the set.
          signerAddresses.add(validatorInfo.operator_address);

          // Update signature data and statistics.
          try {
            await this.updateValidatorSignature(
              validatorInfo,
              blockHeight,
              timestamp,
              round,
              true // Signed.
            );
          } catch (updateError) {
            logger.error({
              error: updateError,
              blockHeight,
              validatorAddress: validatorInfo.operator_address,
              validatorMoniker: validatorInfo.moniker || 'unknown'
            }, 'Error updating signature statistics (signed).');
          }
        } catch (error) {
          logger.error({
            error,
            blockHeight,
            validatorAddress
          }, 'Error processing signer validator information.');
        }
      }

      // Process unsigned validators.
      if (this.options?.trackMissedSignatures) {
        try {
          const allValidators = await validatorInfoService.getAllValidators();

          if (!allValidators || allValidators.length === 0) {
            logger.warn('Failed to retrieve validator list or list is empty, unsigned validators cannot be processed.');
            return;
          }

          logger.debug(`Checking for unsigned blocks for a total of ${allValidators.length} validators (${this.getNetwork()}).`);

          // Determine which validators did not sign.
          for (const validator of allValidators) {
            if (!validator.operator_address) {
              logger.warn({
                validatorMoniker: validator.moniker || 'unknown',
                blockHeight
              }, 'Missing validator address information, skipping.');
              continue;
            }

            if (!signerAddresses.has(validator.operator_address)) {
              try {
                // Update signature data and statistics.
                await this.updateValidatorSignature(
                  validator,
                  blockHeight,
                  timestamp,
                  round,
                  false // Not signed.
                );
              } catch (updateError) {
                logger.error({
                  error: updateError,
                  blockHeight,
                  validatorAddress: validator.operator_address,
                  validatorMoniker: validator.moniker || 'unknown'
                }, 'Error updating signature statistics (not signed).');
              }
            }
          }
        } catch (error) {
          logger.error({
            error,
            blockHeight,
            network: this.getNetwork()
          }, 'Error processing unsigned validators.');
        }
      }
    } catch (error) {
      logger.error({
        error,
        blockInfo: blockData ? JSON.stringify(blockData).substring(0, 200) + '...' : 'null',
        network: this.getNetwork()
      }, 'Error processing WebSocket block data.');
    }
  }

  /**
   * Converts WebSocket block to normal format.
   */
  private normalizeWebSocketBlockData(data: any): BlockData | null {
    try {
      if (!data) return null;

      // WebSocket block comes in Tendermint event format.
      if (data.jsonrpc && data.result && data.result.data && data.result.data.value) {
        const blockData = data.result.data.value;

        return {
          block: blockData.block,
          block_id: blockData.block_id
        };
      }

      // Return directly if already in the correct format.
      if (data.block) {
        return data;
      }

      logger.warn({ data }, 'Unknown websocket block format.');
      return null;
    } catch (error) {
      logger.error({ error, data }, 'WebSocket block data normalization error.');
      return null;
    }
  }

  /**
   * Updates validator signature statistics.
   */
  private async updateValidatorSignature(
    validatorInfo: ValidatorInfo,
    blockHeight: number,
    timestamp: Date,
    round: number,
    signed: boolean
  ): Promise<void> {
    try {
      // validatorInfo check.
      if (!validatorInfo || !validatorInfo.operator_address) {
        logger.warn({
          blockHeight,
          validatorInfo: validatorInfo ? validatorInfo.moniker : 'undefined'
        }, 'Invalid validator information, signature statistics not updated.');
        return;
      }

      // Get or create validator stats.
      let stats = await validatorSignatureRepository.getSignatureStats(
        validatorInfo.operator_address,
        this.getNetwork()
      );

      // Create new stats object.
      if (!stats) {
        stats = {
          validatorAddress: validatorInfo.operator_address,
          totalSignedBlocks: 0,
          totalBlocksInWindow: 0,
          signatureRate: 0,
          consecutiveSigned: 0,
          consecutiveMissed: 0,
          network: this.getNetwork(),
          recentBlocks: [],
          lastUpdated: new Date()
        };
      }

      // Add new block information.
      const newBlockInfo = {
        blockHeight,
        signed,
        round,
        timestamp
      };

      // Update the list of recent blocks.
      stats.recentBlocks.unshift(newBlockInfo);

      // Limit the number of recent blocks to RECENT_BLOCKS_LIMIT.
      if (stats.recentBlocks.length > this.RECENT_BLOCKS_LIMIT) {
        stats.recentBlocks = stats.recentBlocks.slice(0, this.RECENT_BLOCKS_LIMIT);
      }

      // Update consecutive signature counters based on signature status.
      if (signed) {
        stats.consecutiveSigned++;
        stats.consecutiveMissed = 0;
      } else {
        stats.consecutiveMissed++;
        stats.consecutiveSigned = 0;
      }

      // A counter that counts all blocks in the performance window.
      const windowBlockCount = Math.min(stats.totalBlocksInWindow + 1, this.SIGNATURE_PERFORMANCE_WINDOW);

      // Update the number of signed blocks.
      if (signed) {
        // If the window is full and the oldest block is signed, remove it.
        if (stats.totalBlocksInWindow >= this.SIGNATURE_PERFORMANCE_WINDOW) {
          // Keep the signature rate.
        } else {
          stats.totalSignedBlocks++;
        }
      } else {
        // If the window is full and the oldest block is not signed, do nothing.
        if (stats.totalBlocksInWindow >= this.SIGNATURE_PERFORMANCE_WINDOW) {
          // Keep the signature rate.
        }
      }

      // Update the total number of blocks.
      stats.totalBlocksInWindow = windowBlockCount;

      // Calculate the signature rate.
      stats.signatureRate = stats.totalBlocksInWindow > 0
        ? (stats.totalSignedBlocks / stats.totalBlocksInWindow) * 100
        : 0;

      // Set the last update time.
      stats.lastUpdated = new Date();

      // Save to database.
      await validatorSignatureRepository.saveSignatureStats(stats);

      // Threshold check and alarm sending.
      await this.checkSignatureRateThreshold(stats);
      await this.checkConsecutiveMissedBlocks(stats);

    } catch (error) {
      logger.error({
        error,
        validatorAddress: validatorInfo?.operator_address || 'unknown',
        validatorMoniker: validatorInfo?.moniker || 'unknown',
        blockHeight,
        network: this.getNetwork(),
      }, 'Error updating validator signature statistics.');
    }
  }

  /**
   * Loads validator information.
   */
  private async loadValidatorInfo(): Promise<void> {
    try {
      if (!this.client) return;

      // Get all validators.
      const validators = await validatorInfoService.getAllValidators();

      // Add to cache.
      for (const validator of validators) {
        // Add to cache from main address.
        this.validatorInfoCache.set(validator.operator_address, validator);

        // Add to cache from alternative addresses.
        if (validator.alternative_addresses) {
          if (validator.alternative_addresses.bech32) {
            for (const bech32Address of validator.alternative_addresses.bech32) {
              this.validatorInfoCache.set(bech32Address, validator);
            }
          }
          if (validator.alternative_addresses.hex) {
            for (const hexAddress of validator.alternative_addresses.hex) {
              this.validatorInfoCache.set(hexAddress, validator);
            }
          }
        }
      }

      logger.info(`${validators.length} validator information loaded (${this.getNetwork()}).`);
    } catch (error) {
      logger.error({ error, network: this.getNetwork() }, 'Error loading validator information.');
    }
  }

  /**
   * Gets validator information, first checks the cache, otherwise gets it from the service.
   */
  private async getValidatorInfo(address: string): Promise<ValidatorInfo | null> {
    // Check the cache first.
    const cachedInfo = this.validatorInfoCache.get(address);
    if (cachedInfo) return cachedInfo;

    // Get from service if not in cache.
    try {
      const validatorInfo = await validatorInfoService.getValidatorByAnyAddress(address);

      // Add to cache if information is found.
      if (validatorInfo) {
        this.validatorInfoCache.set(address, validatorInfo);

        // Add to cache with alternative addresses as well.
        if (validatorInfo.alternative_addresses) {
          if (validatorInfo.alternative_addresses.bech32) {
            for (const bech32Address of validatorInfo.alternative_addresses.bech32) {
              this.validatorInfoCache.set(bech32Address, validatorInfo);
            }
          }
          if (validatorInfo.alternative_addresses.hex) {
            for (const hexAddress of validatorInfo.alternative_addresses.hex) {
              this.validatorInfoCache.set(hexAddress, validatorInfo);
            }
          }
        }
      }

      return validatorInfo;
    } catch (error) {
      logger.error({ error, address }, 'Error getting validator information.');
      return null;
    }
  }

  /**
   * Checks the signature rate threshold and sends an alarm if necessary.
   */
  private async checkSignatureRateThreshold(stats: ValidatorSignatureStats): Promise<void> {
    if (!this.options) return;

    const threshold = this.options.validatorSignatureThreshold || 90;

    // If at least 100 blocks analyzed and signature rate is below threshold.
    if (stats.totalBlocksInWindow >= 100 && stats.signatureRate < threshold) {
      await this.sendLowSignatureRateAlert(stats);
    }
  }

  /**
   * Checks consecutive missed blocks and sends an alarm if necessary.
   */
  private async checkConsecutiveMissedBlocks(stats: ValidatorSignatureStats): Promise<void> {
    // If 5 or more consecutive blocks missed.
    if (stats.consecutiveMissed >= 5) {
      await this.sendConsecutiveMissedBlocksAlert(stats);
    }
  }

  /**
   * Sends a low signature rate alarm.
   */
  private async sendLowSignatureRateAlert(stats: ValidatorSignatureStats): Promise<void> {
    const message = `Validator low signature rate detected: ${stats.validatorAddress} - Rate: %${stats.signatureRate.toFixed(2)}`;

    const alertPayload: AlertPayload = {
      title: 'Validator Low Signature Rate',
      message,
      severity: AlertSeverity.WARNING,
      network: this.getNetwork(),
      timestamp: new Date(),
      metadata: {
        validatorAddress: stats.validatorAddress,
        network: stats.network,
        signatureRate: stats.signatureRate
      }
    };

    await notificationManager.sendAlert(alertPayload);
  }

  /**
   * Sends an alarm for consecutive missed blocks.
   */
  private async sendConsecutiveMissedBlocksAlert(stats: ValidatorSignatureStats): Promise<void> {
    const message = `Validator consecutive ${stats.consecutiveMissed} blocks missed: ${stats.validatorAddress}`;

    const alertPayload: AlertPayload = {
      title: 'Validator Consecutive Blocks Missed',
      message,
      severity: AlertSeverity.CRITICAL,
      network: this.getNetwork(),
      timestamp: new Date(),
      metadata: {
        validatorAddress: stats.validatorAddress,
        network: stats.network,
        consecutiveMissed: stats.consecutiveMissed
      }
    };

    await notificationManager.sendAlert(alertPayload);
  }

  /**
   * Checks whether the service is enabled.
   */
  isEnabled(): boolean {
    return this.options?.enabled === true;
  }

  /**
   * Returns the service name.
   */
  getName(): string {
    return 'ValidatorSignatureService';
  }

  /**
   * Returns the network name.
   */
  getNetwork(): Network {
    return this.options?.network || Network.MAINNET;
  }

  /**
   * Checks signature flags.
   */
  private isBlockIdFlagCommit(flag: any): boolean {
    // Numeric check.
    if (typeof flag === 'number') {
      return flag === this.BLOCK_ID_FLAG_COMMIT;
    }
    // String check.
    if (typeof flag === 'string') {
      return flag === this.BLOCK_ID_FLAG_COMMIT_STR || flag === String(this.BLOCK_ID_FLAG_COMMIT);
    }
    // If undefined or null, consider unsigned.
    return false;
  }
}

// Singleton instance.
const validatorSignatureService = new ValidatorSignatureService();
export default validatorSignatureService;