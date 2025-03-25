import { Collection } from 'mongodb';
import mongodb from '../mongodb';
import logger from '../../utils/logger';
import { FinalityProviderSignature, FinalityProviderSignatureStats, FinalityProviderInfo } from '../../models/finality-provider-signature.model';
import { Network } from '../../config/config';

export class FinalityProviderSignatureRepository {
  private collection: Collection<FinalityProviderSignature> | null = null;
  private statsCollection: Collection<FinalityProviderSignatureStats> | null = null;
  private infoCollection: Collection<FinalityProviderInfo> | null = null;
  private readonly COLLECTION_NAME = 'finality_provider_signatures';
  private readonly STATS_COLLECTION_NAME = 'finality_provider_signature_stats';
  private readonly INFO_COLLECTION_NAME = 'finality_provider_info';

  async initialize(): Promise<void> {
    const db = await mongodb.getDb();
    this.collection = db.collection<FinalityProviderSignature>(this.COLLECTION_NAME);
    this.statsCollection = db.collection<FinalityProviderSignatureStats>(this.STATS_COLLECTION_NAME);
    this.infoCollection = db.collection<FinalityProviderInfo>(this.INFO_COLLECTION_NAME);

    // Create indexes
    await this.collection.createIndex({ fpBtcPkHex: 1, blockHeight: 1, network: 1 }, { unique: true });
    await this.collection.createIndex({ blockHeight: 1, network: 1 });
    await this.collection.createIndex({ network: 1, timestamp: 1 });

    await this.statsCollection.createIndex({ fpBtcPkHex: 1, network: 1 }, { unique: true });
    await this.statsCollection.createIndex({ network: 1 });

    await this.infoCollection.createIndex({ fpBtcPkHex: 1 }, { unique: true });

    logger.info('FinalityProviderSignatureRepository initialized');
  }

  async saveSignature(signature: FinalityProviderSignature): Promise<void> {
    try {
      if (!this.collection) await this.initialize();
      await this.collection!.updateOne(
        { 
          fpBtcPkHex: signature.fpBtcPkHex, 
          blockHeight: signature.blockHeight,
          network: signature.network
        },
        { $set: signature },
        { upsert: true }
      );
    } catch (error) {
      logger.error({ error, signature }, 'Failed to save finality provider signature');
      throw error;
    }
  }

  async saveSignatureStats(stats: FinalityProviderSignatureStats): Promise<void> {
    try {
      if (!this.statsCollection) await this.initialize();
      await this.statsCollection!.updateOne(
        { 
          fpBtcPkHex: stats.fpBtcPkHex,
          network: stats.network
        },
        { $set: stats },
        { upsert: true }
      );
    } catch (error) {
      logger.error({ error, stats }, 'Failed to save finality provider signature statistics');
      throw error;
    }
  }

  async saveFinalityProviderInfo(info: FinalityProviderInfo): Promise<void> {
    try {
      if (!this.infoCollection) await this.initialize();
      await this.infoCollection!.updateOne(
        { fpBtcPkHex: info.fpBtcPkHex },
        { $set: info },
        { upsert: true }
      );
    } catch (error) {
      logger.error({ error, info }, 'Failed to save finality provider info');
      throw error;
    }
  }

  async getSignatureStats(fpBtcPkHex: string, network: Network): Promise<FinalityProviderSignatureStats | null> {
    try {
      if (!this.statsCollection) await this.initialize();
      return this.statsCollection!.findOne({ fpBtcPkHex, network });
    } catch (error) {
      logger.error({ error, fpBtcPkHex, network }, 'Failed to get finality provider signature statistics');
      throw error;
    }
  }

  async getAllSignatureStats(network: Network): Promise<FinalityProviderSignatureStats[]> {
    try {
      if (!this.statsCollection) await this.initialize();
      return this.statsCollection!.find({ network }).toArray();
    } catch (error) {
      logger.error({ error, network }, 'Failed to get all finality provider signature statistics');
      throw error;
    }
  }

  async getFinalityProviderInfo(fpBtcPkHex: string): Promise<FinalityProviderInfo | null> {
    try {
      if (!this.infoCollection) await this.initialize();
      return this.infoCollection!.findOne({ fpBtcPkHex });
    } catch (error) {
      logger.error({ error, fpBtcPkHex }, 'Failed to get finality provider info');
      throw error;
    }
  }

  async getRecentSignatures(fpBtcPkHex: string, network: Network, limit: number = 100): Promise<FinalityProviderSignature[]> {
    try {
      if (!this.collection) await this.initialize();
      return this.collection!.find({ fpBtcPkHex, network })
        .sort({ blockHeight: -1 })
        .limit(limit)
        .toArray();
    } catch (error) {
      logger.error({ error, fpBtcPkHex, network }, 'Failed to get recent finality provider signatures');
      throw error;
    }
  }

  /**
   * Finds the last processed block height in the database for a specific network
   */
  async getLastProcessedHeight(network: Network): Promise<number | null> {
    try {
      if (!this.collection) await this.initialize();
      
      // Find the last signature (the one with the highest block height)
      const result = await this.collection!.find({ network })
        .sort({ blockHeight: -1 })
        .limit(1)
        .toArray();
        
      if (result.length > 0) {
        return result[0].blockHeight;
      }
      
      return null;
    } catch (error) {
      logger.error({ error, network }, 'Error finding last processed block height');
      return null;
    }
  }
}

// Singleton instance
const finalityProviderSignatureRepository = new FinalityProviderSignatureRepository();
export default finalityProviderSignatureRepository;