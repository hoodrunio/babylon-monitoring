import crypto from 'crypto';
import { bech32 } from 'bech32';

/**
 * Helper class for address conversions
 */
class AddressConverter {
  /**
   * Converts a Bech32 address to hex format
   * @param bech32Address Address in Bech32 format
   */
  async bech32ToHex(bech32Address: string): Promise<string> {
    try {
      // Decode Bech32 address
      const decoded = bech32.decode(bech32Address);
      const words = decoded.words;

      // Convert words to 8-bit array
      const data = bech32.fromWords(words);

      // Convert to buffer and return hex string
      return Buffer.from(data).toString('hex').toUpperCase();
    } catch (error) {
      throw new Error(`Failed to convert Bech32 address to hex: ${error}`);
    }
  }

  /**
   * Converts a hex address to Bech32 format
   * @param hexAddress Address in hex format
   * @param prefix Bech32 prefix (e.g. 'bbn')
   */
  async hexToBech32(hexAddress: string, prefix: string = 'bbn'): Promise<string> {
    try {
      // Convert hex string to buffer
      const data = Buffer.from(hexAddress, 'hex');

      // Convert buffer to words array
      const words = bech32.toWords(data);

      // Encode to Bech32
      return bech32.encode(prefix, words);
    } catch (error) {
      throw new Error(`Failed to convert hex address to Bech32: ${error}`);
    }
  }

  /**
   * Creates a consensus address from a pubkey
   * @param pubkey Pubkey in Base64 format
   */
  pubkeyToConsAddress(pubkey: string): string {
    try {
      // Convert Base64 pubkey to buffer
      const pubkeyBuffer = Buffer.from(pubkey, 'base64');

      // Create SHA-256 hash
      const hash = crypto.createHash('sha256').update(pubkeyBuffer).digest();

      // Take the first 20 bytes (similar to RIPEMD-160)
      const addressBytes = hash.slice(0, 20);

      // Convert to Bech32 format
      const words = bech32.toWords(addressBytes);
      return bech32.encode('bbnvalcons', words);
    } catch (error) {
      throw new Error(`Failed to convert pubkey to consensus address: ${error}`);
    }
  }

  /**
   * Creates an operator address from a pubkey
   * @param pubkey Pubkey in Base64 format
   */
  pubkeyToOperAddress(pubkey: string): string {
    try {
      // Convert Base64 pubkey to buffer
      const pubkeyBuffer = Buffer.from(pubkey, 'base64');

      // Create SHA-256 hash
      const hash = crypto.createHash('sha256').update(pubkeyBuffer).digest();

      // Take the first 20 bytes
      const addressBytes = hash.slice(0, 20);

      // Convert to Bech32 format
      const words = bech32.toWords(addressBytes);
      return bech32.encode('bbnvaloper', words);
    } catch (error) {
      throw new Error(`Failed to convert pubkey to operator address: ${error}`);
    }
  }
}

// Singleton instance
export const addressConverter = new AddressConverter();