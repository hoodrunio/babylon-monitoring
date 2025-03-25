import { MongoClient, Db } from 'mongodb';
import config from '../config/config';
import logger from '../utils/logger';

class MongoDB {
  private client: MongoClient | null = null;
  private db: Db | null = null;

  async connect(): Promise<Db> {
    if (this.db) return this.db;

    try {
      logger.info('Connecting to MongoDB...');
      this.client = new MongoClient(config.mongodbUri);
      await this.client.connect();
      this.db = this.client.db();
      logger.info('MongoDB connection successful');
      return this.db;
    } catch (error) {
      logger.error({ error }, 'MongoDB connection failed');
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.db = null;
      logger.info('MongoDB connection closed');
    }
  }

  async getDb(): Promise<Db> {
    if (!this.db) {
      return this.connect();
    }
    return this.db;
  }
}

// Singleton instance
const mongodb = new MongoDB();
export default mongodb;