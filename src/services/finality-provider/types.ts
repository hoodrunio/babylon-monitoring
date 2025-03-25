export interface VoteResponse {
  height: string;
  btc_pks: string[];
}

export interface FinalityProviderResponse {
  finality_providers: Array<{
    description: {
      moniker: string;
      identity: string;
      website: string;
      security_contact: string;
      details: string;
    };
    commission: string;
    addr: string;
    btc_pk: string;
    pop: {
      btc_sig_type: string;
      btc_sig: string;
    };
    slashed_babylon_height: string;
    slashed_btc_height: number;
    height: string;
    jailed: boolean;
    highest_voted_height: number;
  }>;
  pagination: {
    next_key: string;
    total: string;
  };
}

export interface BlockToProcess {
  height: number;
  timestamp: Date;
}

export interface EpochInfo {
  currentEpoch: number;
  epochBoundary: number;
}

export interface ActiveFinalityProvider {
  btc_pk_hex: string;
  jailed?: boolean;
}

export interface BlockVotes {
  height: number;
  signers: Set<string>;
  timestamp: Date;
}

export interface ServiceConstants {
  MAX_CACHE_SIZE: number;
  FINALIZED_BLOCKS_WAIT: number;
  EPOCH_BLOCKS: number;
  MAX_SYNC_BLOCKS: number;
  SYNC_GAP_THRESHOLD: number;
  SIGNATURE_RATE_THRESHOLD_STEPS: number;
}

export interface ProviderAlertState {
  lastAlertedSignatureRate: number;
  isRecovering: boolean;
  lastCriticalAlertTime?: Date;
  sentMissedBlockAlert: boolean;
  sentUptimeAlert: boolean;
}

export interface SyncStatus {
  lastProcessedHeight: number;
  isInitialSyncComplete: boolean;
} 