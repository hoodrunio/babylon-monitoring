import { Collection, Db, ObjectId, ReturnDocument } from 'mongodb';
import logger from '../../utils/logger';
import mongodb from '../mongodb';
import { ValidatorInfo } from '../../models/validator-info.model';
import { Network } from '../../config/config';

/**
 * Validator bilgileri için repository sınıfı
 */
export class ValidatorInfoRepository {
  private collection: Collection<ValidatorInfo> | null = null;
  private db: Db | null = null;
  private readonly COLLECTION_NAME = 'validator_info';
  
  /**
   * Repository'yi başlatır
   */
  async initialize(): Promise<void> {
    try {
      if (!this.collection) {
        this.db = await mongodb.getDb();
        this.collection = this.db.collection<ValidatorInfo>(this.COLLECTION_NAME);
        
        // İndexler oluştur
        await this.collection.createIndex({ validator_address: 1, network: 1 }, { unique: true });
        await this.collection.createIndex({ validator_hex_address: 1, network: 1 });
        await this.collection.createIndex({ operator_address: 1, network: 1 });
        await this.collection.createIndex({ moniker: 1 });
        await this.collection.createIndex({ 'alternative_addresses.bech32': 1 });
        await this.collection.createIndex({ 'alternative_addresses.hex': 1 });
        
        logger.info(`ValidatorInfoRepository başlatıldı (${this.COLLECTION_NAME})`);
      }
    } catch (error) {
      logger.error({ error }, `ValidatorInfoRepository başlatılırken hata oluştu (${this.COLLECTION_NAME})`);
      throw error;
    }
  }
  
  /**
   * Validator bilgisini kaydeder (yeni veya güncelleme)
   * @param validator Kaydedilecek validator bilgisi
   */
  async saveValidator(validator: ValidatorInfo): Promise<ObjectId> {
    try {
      if (!this.collection) await this.initialize();
      
      const query = { 
        validator_address: validator.validator_address,
        network: validator.network 
      };
      
      const update = { 
        $set: { 
          ...validator, 
          last_updated: new Date() 
        } 
      };
      
      const options = { upsert: true, returnDocument: ReturnDocument.AFTER };
      const result = await this.collection!.findOneAndUpdate(query, update, options);
      
      if (result && result._id) {
        return result._id;
      } else {
        throw new Error('Validator kaydedilirken beklenmeyen bir hata oluştu');
      }
    } catch (error) {
      logger.error({ error, validator }, 'Validator bilgisi kaydedilirken hata oluştu');
      throw error;
    }
  }
  
  /**
   * Validator'ı consensus adresi ile bulur
   * @param address Konsensus adresi
   * @param network Ağ
   */
  async findByConsensusAddress(address: string, network: Network): Promise<ValidatorInfo | null> {
    try {
      if (!this.collection) await this.initialize();
      return this.collection!.findOne({ validator_address: address, network });
    } catch (error) {
      logger.error({ error, address, network }, 'Validator konsensus adresine göre aranırken hata oluştu');
      throw error;
    }
  }
  
  /**
   * Validator'ı hex adresi ile bulur
   * @param hexAddress Hex adresi
   * @param network Ağ
   */
  async findByHexAddress(hexAddress: string, network: Network): Promise<ValidatorInfo | null> {
    try {
      if (!this.collection) await this.initialize();
      
      const result = await this.collection!.findOne({ 
        $or: [
          { validator_hex_address: hexAddress },
          { 'alternative_addresses.hex': hexAddress }
        ],
        network
      });
      
      return result;
    } catch (error) {
      logger.error({ error, hexAddress, network }, 'Validator hex adresine göre aranırken hata oluştu');
      throw error;
    }
  }
  
  /**
   * Validator'ı operator adresi (valoper) ile bulur
   * @param operatorAddress Operator adresi
   * @param network Ağ
   */
  async findByOperatorAddress(operatorAddress: string, network: Network): Promise<ValidatorInfo | null> {
    try {
      if (!this.collection) await this.initialize();
      return this.collection!.findOne({ operator_address: operatorAddress, network });
    } catch (error) {
      logger.error({ error, operatorAddress, network }, 'Validator operator adresine göre aranırken hata oluştu');
      throw error;
    }
  }
  
  /**
   * Herhangi bir adres formatına göre validator'ı bulur
   * @param address Adres (herhangi bir formatta)
   * @param network Ağ
   */
  async findByAnyAddress(address: string, network: Network): Promise<ValidatorInfo | null> {
    try {
      if (!this.collection) await this.initialize();
      
      // Tüm olası adres alanlarında ara
      const result = await this.collection!.findOne({
        $or: [
          { validator_address: address },
          { validator_hex_address: address },
          { operator_address: address },
          { 'alternative_addresses.bech32': address },
          { 'alternative_addresses.hex': address }
        ],
        network
      });
      
      return result;
    } catch (error) {
      logger.error({ error, address, network }, 'Validator herhangi bir adrese göre aranırken hata oluştu');
      throw error;
    }
  }
  
  /**
   * Adı (moniker) ile validator'ı bulur
   * @param moniker Validator adı
   * @param network Ağ
   */
  async findByMoniker(moniker: string, network: Network): Promise<ValidatorInfo | null> {
    try {
      if (!this.collection) await this.initialize();
      return this.collection!.findOne({ moniker, network });
    } catch (error) {
      logger.error({ error, moniker, network }, 'Validator moniker\'a göre aranırken hata oluştu');
      throw error;
    }
  }
  
  /**
   * Belirli bir ağdaki tüm validator'ları getirir
   * @param network Ağ
   * @param limit Maksimum sonuç sayısı
   */
  async getAllValidators(network: Network, limit: number = 1000): Promise<ValidatorInfo[]> {
    try {
      if (!this.collection) await this.initialize();
      return this.collection!.find({ network }).limit(limit).toArray();
    } catch (error) {
      logger.error({ error, network }, 'Tüm validatorlar alınırken hata oluştu');
      throw error;
    }
  }
  
  /**
   * Bir validator bilgisine alternatif adres ekler
   * @param validatorId Validator ID
   * @param adresType Adres tipi ('bech32' veya 'hex')
   * @param address Eklenecek adres
   */
  async addAlternativeAddress(validatorId: ObjectId, adresType: 'bech32' | 'hex', address: string): Promise<void> {
    try {
      if (!this.collection) await this.initialize();
      
      // Adres alanı formatını belirle
      const addressField = `alternative_addresses.${adresType}`;
      
      // Adresi ekle (eğer zaten yoksa)
      await this.collection!.updateOne(
        { _id: validatorId },
        { 
          $addToSet: { [addressField]: address },
          $set: { last_updated: new Date() }
        }
      );
    } catch (error) {
      logger.error({ error, validatorId, adresType, address }, 'Alternatif adres eklenirken hata oluştu');
      throw error;
    }
  }

  /**
   * Validator sayısını döndürür
   * @param network Ağ
   */
  async getValidatorCount(network: Network): Promise<number> {
    try {
      if (!this.collection) await this.initialize();
      return this.collection!.countDocuments({ network });
    } catch (error) {
      logger.error({ error, network }, 'Validator sayısı alınırken hata oluştu');
      throw error;
    }
  }
}

// Singleton örneği
const validatorInfoRepository = new ValidatorInfoRepository();
export default validatorInfoRepository; 