import { FinalityProviderInfo } from '../../models/finality-provider-signature.model';
import finalityProviderSignatureRepository from '../../database/repositories/finality-provider-signature.repository';
import logger from '../../utils/logger';
import { Network } from '../../config/config';
import { FinalityProviderApiClient } from './api-client';
import { NotificationService } from './notification-service';

/**
 * Service that manages Finality Provider information
 */
export class ProviderManager {
  private providerMap: Map<string, FinalityProviderInfo> = new Map();
  private activeProviders: Set<string> = new Set();
  private previousJailedStatus: Map<string, boolean> = new Map();

  constructor(
    private readonly apiClient: FinalityProviderApiClient,
    private readonly notificationService: NotificationService,
    private readonly network: Network
  ) {}

  /**
   * Loads Finality Provider information
   */
  async loadFinalityProviderInfo(): Promise<void> {
    try {
      const finalityProviders = await this.apiClient.getFinalityProviders();
      
      this.providerMap.clear();
      
      for (const fp of finalityProviders) {
        const fpBtcPkHex = fp.btc_pk;
        
        const fpInfo: FinalityProviderInfo = {
          fpBtcPkHex,
          fpBtcAddress: fp.btc_pk,
          addr: fp.addr,
          ownerAddress: fp.addr,
          moniker: fp.description?.moniker,
          identity: fp.description?.identity,
          website: fp.description?.website,
          securityContact: fp.description?.security_contact,
          details: fp.description?.details,
          commission: fp.commission,
          description: fp.description?.moniker,
          jailed: fp.jailed,
          slashedHeight: fp.slashed_babylon_height,
          slashedBtcHeight: fp.slashed_btc_height,
          height: fp.height,
          highestVotedHeight: fp.highest_voted_height,
          isActive: false // Not active by default, will be updated later
        };
        
        // Check for Jailed status change
        await this.checkAndNotifyJailedStatusChange(fpInfo);
        
        // Add provider to memory
        this.providerMap.set(fpBtcPkHex, fpInfo);
        
        // Save to database
        await finalityProviderSignatureRepository.saveFinalityProviderInfo(fpInfo);
      }
      
      logger.info(`${finalityProviders.length} finality providers loaded from ${this.network} network`);
    } catch (error) {
      logger.error({ error }, 'Error loading finality provider information');
      throw error;
    }
  }

  /**
   * Updates active finality providers
   */
  async updateActiveFinalityProviders(height: number): Promise<void> {
    try {
      // Get active finality providers
      const activeProviders = await this.apiClient.getActiveFinalityProviders(height);
      
      // Clear and update the set
      this.activeProviders.clear();
      
      // Mark all finality providers as inactive first
      for (const [fpBtcPkHex, fpInfo] of this.providerMap.entries()) {
        fpInfo.isActive = false;
      }
      
      // Add BTC public keys to the set and mark each one as active
      for (const provider of activeProviders) {
        if (provider.btc_pk_hex) {
          // Add to active set
          this.activeProviders.add(provider.btc_pk_hex);
          
          // Update if it exists in the current FP information
          // Because the return format is different (btc_pk vs btc_pk_hex)
          // We check to find the correct record in the mapping
          for (const [fpBtcPkHex, fpInfo] of this.providerMap.entries()) {
            if (fpBtcPkHex === provider.btc_pk_hex) {
              fpInfo.isActive = true;
              // Update the database
              await finalityProviderSignatureRepository.saveFinalityProviderInfo(fpInfo);
              break;
            }
          }
        }
      }
    } catch (error) {
      logger.error({ 
        error, 
        height 
      }, 'Error updating active finality provider list');
    }
  }

  /**
   * Checks for Jailed status changes and sends a notification
   */
  private async checkAndNotifyJailedStatusChange(fpInfo: FinalityProviderInfo): Promise<void> {
    const previousJailed = this.previousJailedStatus.get(fpInfo.fpBtcPkHex);
    const currentJailed = fpInfo.jailed === true;
    
    // If the previous status is known and has changed
    if (previousJailed !== undefined && previousJailed !== currentJailed) {
      await this.notificationService.sendJailedStatusChangeAlert(fpInfo, previousJailed, currentJailed);
    }
    
    // Update the Jailed status
    this.previousJailedStatus.set(fpInfo.fpBtcPkHex, currentJailed);
  }

  /**
   * Returns the Finality Provider map
   */
  getProviderMap(): Map<string, FinalityProviderInfo> {
    return this.providerMap;
  }

  /**
   * Returns the active Finality Provider set
   */
  getActiveProviders(): Set<string> {
    return this.activeProviders;
  }
}