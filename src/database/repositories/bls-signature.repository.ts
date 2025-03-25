import { Collection } from 'mongodb';
import mongodb from '../mongodb';
import logger from '../../utils/logger';
import { BLSValidatorSignature, BLSCheckpointStats } from '../../models/bls-signature.model';
import { Network } from '../../config/config';

export class BLSSignatureRepository {
  private collection: Collection<BLSValidatorSignature> | null = null;
  private statsCollection: Collection<BLSCheckpointStats> | null = null;
  private readonly COLLECTION_NAME = 'bls_validator_signatures';
  private readonly STATS_COLLECTION_NAME = 'bls_checkpoint_stats';

  async initialize(): Promise<void> {
    const db = await mongodb.getDb();
    this.collection = db.collection<BLSValidatorSignature>(this.COLLECTION_NAME);
    this.statsCollection = db.collection<BLSCheckpointStats>(this.STATS_COLLECTION_NAME);

    // Create indexes
    await this.collection.createIndex({ validatorAddress: 1, epochNum: 1, network: 1 }, { unique: true });
    await this.collection.createIndex({ epochNum: 1, network: 1 });
    await this.collection.createIndex({ network: 1, timestamp: 1 });

    await this.statsCollection.createIndex({ epochNum: 1, network: 1 }, { unique: true });
    await this.statsCollection.createIndex({ network: 1 });

    logger.info('BLSSignatureRepository initialized');
  }

  async saveSignature(signature: BLSValidatorSignature): Promise<void> {
    try {
      if (!this.collection) await this.initialize();
      await this.collection!.updateOne(
        { 
          validatorAddress: signature.validatorAddress, 
          epochNum: signature.epochNum,
          network: signature.network
        },
        { $set: signature },
        { upsert: true }
      );
    } catch (error) {
      logger.error({ error, signature }, 'Failed to save BLS signature');
      throw error;
    }
  }

  async saveCheckpointStats(stats: BLSCheckpointStats): Promise<void> {
    try {
      if (!this.statsCollection) await this.initialize();
      await this.statsCollection!.updateOne(
        { 
          epochNum: stats.epochNum,
          network: stats.network
        },
        { $set: stats },
        { upsert: true }
      );
    } catch (error) {
      logger.error({ error, stats }, 'Failed to save BLS checkpoint statistics');
      throw error;
    }
  }

  async getCheckpointStats(epochNum: number, network: Network): Promise<BLSCheckpointStats | null> {
    try {
      if (!this.statsCollection) await this.initialize();
      return this.statsCollection!.findOne({ epochNum, network });
    } catch (error) {
      logger.error({ error, epochNum, network }, 'Failed to get BLS checkpoint statistics');
      throw error;
    }
  }

  async getValidatorSignaturesForEpoch(epochNum: number, network: Network): Promise<BLSValidatorSignature[]> {
    try {
      if (!this.collection) await this.initialize();
      return this.collection!.find({ epochNum, network }).toArray();
    } catch (error) {
      logger.error({ error, epochNum, network }, 'Failed to get validator BLS signatures for epoch');
      throw error;
    }
  }

  async getValidatorSignatures(validatorAddress: string, network: Network, limit: number = 10): Promise<BLSValidatorSignature[]> {
    try {
      if (!this.collection) await this.initialize();
      return this.collection!.find({ validatorAddress, network })
        .sort({ epochNum: -1 })
        .limit(limit)
        .toArray();
    } catch (error) {
      logger.error({ error, validatorAddress, network }, 'Failed to get validator BLS signatures');
      throw error;
    }
  }

  async getRecentCheckpointStats(network: Network, limit: number = 10): Promise<BLSCheckpointStats[]> {
    try {
      if (!this.statsCollection) await this.initialize();
      return this.statsCollection!.find({ network })
        .sort({ epochNum: -1 })
        .limit(limit)
        .toArray();
    } catch (error) {
      logger.error({ error, network }, 'Failed to get recent BLS checkpoint statistics');
      throw error;
    }
  }
}

// Singleton instance
const blsSignatureRepository = new BLSSignatureRepository();
export default blsSignatureRepository;