import logger from '../../utils/logger';
import { addressConverter as globalAddressConverter } from '../../utils/address-converter';

/**
 * Class for converting between different validator address formats
 */
export class AddressConverter {
  /**
   * Converts a consensus public key to consensus address
   */
  public pubkeyToConsAddress(pubkey: string): string {
    try {
      return globalAddressConverter.pubkeyToConsAddress(pubkey);
    } catch (error) {
      logger.error({ error, pubkey }, 'Error converting pubkey to consensus address');
      throw error;
    }
  }

  /**
   * Converts bech32 address to hex address
   */
  public async bech32ToHex(bech32Address: string): Promise<string> {
    try {
      return await globalAddressConverter.bech32ToHex(bech32Address);
    } catch (error) {
      logger.error({ error, bech32Address }, 'Error converting bech32 address to hex');
      throw error;
    }
  }

  /**
   * Converts hex address to bech32 address
   */
  public async hexToBech32(hexAddress: string, prefix: string): Promise<string> {
    try {
      return await globalAddressConverter.hexToBech32(hexAddress, prefix);
    } catch (error) {
      logger.error({ error, hexAddress, prefix }, 'Error converting hex address to bech32');
      throw error;
    }
  }
} 