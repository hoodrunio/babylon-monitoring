export interface BlockData {
  block: {
    header: {
      height: string;
      time: string;
      proposer_address?: string;
      proposerAddress?: string;
    };
    last_commit?: {
      height: string;
      round: number | string;
      signatures: Array<BlockSignature>;
    };
    lastCommit?: {
      height: string;
      round: number | string;
      signatures: Array<BlockSignature>;
    };
  };
  block_id?: {
    hash: string;
  };
  blockId?: {
    hash: string;
  };
}

export interface BlockSignature {
  block_id_flag?: number | string;
  blockIdFlag?: number | string;
  validator_address?: string;
  validatorAddress?: string;
  timestamp: string;
  signature: string | null;
}

export interface BlockVotes {
  height: number;
  signers: Set<string>;
  timestamp: Date;
  round: number;
}

export interface ServiceConstants {
  BLOCK_ID_FLAG_COMMIT: number;
  BLOCK_ID_FLAG_COMMIT_STR: string;
  RECENT_BLOCKS_LIMIT: number;
  SIGNATURE_PERFORMANCE_WINDOW: number;
  MAX_CACHE_SIZE: number;
}

export interface ValidatorAlertState {
  lastAlertedSignatureRate: number;
  isRecovering: boolean;
  lastCriticalAlertTime?: Date;
  lastSignatureRateAlertTime?: Date;
  lastRecoveryAlertTime?: Date;
  sentConsecutiveBlocksAlert: boolean;
  sentUptimeAlert: boolean;
}

export interface ValidatorBlockInfo {
  blockHeight: number;
  signed: boolean;
  round: number;
  timestamp: Date;
} 