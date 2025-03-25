import { Collection } from 'mongodb';
import mongodb from '../mongodb';
import logger from '../../utils/logger';
import { ValidatorSignatureStats } from '../../models/validator-signature.model';
import { Network } from '../../config/config';

export class ValidatorSignatureRepository {
  private statsCollection: Collection<ValidatorSignatureStats> | null = null;
  private readonly STATS_COLLECTION_NAME = 'validator_signature_stats';

  async initialize(): Promise<void> {
    const db = await mongodb.getDb();
    this.statsCollection = db.collection<ValidatorSignatureStats>(this.STATS_COLLECTION_NAME);

    // Create indexes
    await this.statsCollection.createIndex({ validatorAddress: 1, network: 1 }, { unique: true });
    await this.statsCollection.createIndex({ network: 1 });

    logger.info('ValidatorSignatureRepository initialized');
  }

  async saveSignatureStats(stats: ValidatorSignatureStats): Promise<void> {
    try {
      if (!this.statsCollection) {
        await this.initialize();
        if (!this.statsCollection) {
          throw new Error('Failed to initialize validator signature stats collection');
        }
      }

      // Check required fields
      if (!stats.validatorAddress || !stats.network) {
        throw new Error('Invalid statistics data: Missing required fields');
      }
      
      // Check recentBlocks
      if (!Array.isArray(stats.recentBlocks)) {
        stats.recentBlocks = [];
        logger.warn({ 
          validatorAddress: stats.validatorAddress,
          network: stats.network
        }, 'recentBlocks array is invalid, replaced with empty array');
      }
      
      // Check last update time
      if (!stats.lastUpdated) {
        stats.lastUpdated = new Date();
      }

      // Remove validator field before saving (we'll get it with populate)
      const { validator, ...statsToSave } = stats;

      const result = await this.statsCollection.updateOne(
        { 
          validatorAddress: stats.validatorAddress,
          network: stats.network
        },
        { 
          $set: {
            ...statsToSave,
            lastUpdated: stats.lastUpdated || new Date()
          }
        },
        { upsert: true }
      );

      if (!result.acknowledged) {
        throw new Error('MongoDB operation not acknowledged');
      }

      logger.debug({ 
        validatorAddress: stats.validatorAddress,
        network: stats.network,
        matchedCount: result.matchedCount,
        modifiedCount: result.modifiedCount,
        upsertedCount: result.upsertedCount
      }, 'Validator signature statistics saved');
    } catch (error) {
      logger.error({ error, stats }, 'Failed to save validator signature statistics');
      throw error;
    }
  }

  async getSignatureStats(validatorAddress: string, network: Network): Promise<ValidatorSignatureStats | null> {
    try {
      if (!this.statsCollection) await this.initialize();
      const db = await mongodb.getDb();
      
      const stats = await this.statsCollection!.aggregate<ValidatorSignatureStats>([
        { $match: { validatorAddress, network } },
        {
          $lookup: {
            from: 'validator_info',
            let: { validatorAddress: '$validatorAddress', network: '$network' },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ['$operator_address', '$$validatorAddress'] },
                      { $eq: ['$network', '$$network'] }
                    ]
                  }
                }
              }
            ],
            as: 'validator'
          }
        },
        { $unwind: { path: '$validator', preserveNullAndEmptyArrays: true } }
      ]).next();

      return stats;
    } catch (error) {
      logger.error({ error, validatorAddress, network }, 'Failed to get validator signature statistics');
      throw error;
    }
  }

  async getAllSignatureStats(network: Network): Promise<ValidatorSignatureStats[]> {
    try {
      if (!this.statsCollection) await this.initialize();
      return this.statsCollection!.find({ network }).toArray();
    } catch (error) {
      logger.error({ error, network }, 'Failed to get all validator signature statistics');
      throw error;
    }
  }
}

// Singleton instance
const validatorSignatureRepository = new ValidatorSignatureRepository();
export default validatorSignatureRepository;