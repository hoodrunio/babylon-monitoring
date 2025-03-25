import { Collection } from 'mongodb';
import mongodb from '../mongodb';
import logger from '../../utils/logger';
import { FinalityProviderSignatureStats, FinalityProviderInfo } from '../../models/finality-provider-signature.model';
import { Network } from '../../config/config';

export class FinalityProviderSignatureRepository {
  private statsCollection: Collection<FinalityProviderSignatureStats> | null = null;
  private infoCollection: Collection<FinalityProviderInfo> | null = null;
  private readonly STATS_COLLECTION_NAME = 'finality_provider_signature_stats';
  private readonly INFO_COLLECTION_NAME = 'finality_provider_info';

  async initialize(): Promise<void> {
    const db = await mongodb.getDb();
    this.statsCollection = db.collection<FinalityProviderSignatureStats>(this.STATS_COLLECTION_NAME);
    this.infoCollection = db.collection<FinalityProviderInfo>(this.INFO_COLLECTION_NAME);

    // Create indexes
    await this.statsCollection.createIndex({ fpBtcPkHex: 1, network: 1 }, { unique: true });
    await this.statsCollection.createIndex({ network: 1 });

    await this.infoCollection.createIndex({ fpBtcPkHex: 1 }, { unique: true });

    logger.info('FinalityProviderSignatureRepository initialized');
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
}

// Singleton instance
const finalityProviderSignatureRepository = new FinalityProviderSignatureRepository();
export default finalityProviderSignatureRepository;