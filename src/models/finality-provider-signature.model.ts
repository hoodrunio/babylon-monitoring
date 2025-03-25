import { Network } from '../config/config';

export interface FinalityProviderInfo {
  fpBtcPkHex: string;
  fpBtcAddress?: string;
  addr?: string;
  ownerAddress?: string;
  moniker?: string;
  identity?: string;
  website?: string;
  securityContact?: string;
  details?: string;
  commission?: string;
  description?: string;
  jailed?: boolean;
  slashedHeight?: string;
  slashedBtcHeight?: number;
  height?: string;
  highestVotedHeight?: number;
  isActive?: boolean;
}

export interface FinalityProviderSignatureStats {
  fpBtcPkHex: string;
  fpBtcAddress?: string;
  moniker?: string;
  ownerAddress?: string;
  description?: string;
  startHeight: number;
  endHeight: number;
  totalBlocks: number;
  signedBlocks: number;
  missedBlocks: number;
  signatureRate: number;
  network: Network;
  lastUpdated: Date;
  missedBlockHeights: number[];
  jailed?: boolean;
  isActive?: boolean;
} 