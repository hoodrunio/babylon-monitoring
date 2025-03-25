import { Network } from '../../config/config';

export interface EpochResponse {
  current_epoch: string;
  epoch_boundary: string;
}

export interface BlockTransactionsResponse {
  txs: Array<{
    body: {
      messages: Array<{
        '@type': string;
        extended_commit_info?: {
          votes: Array<{
            validator: {
              address: string;
              power: string;
            };
            vote_extension?: string;
            extension_signature?: string;
            block_id_flag: string;
          }>;
        };
        ckpt?: {
          ckpt: {
            epoch_num: string;
            block_hash: string;
            bitmap: string;
            bls_multi_sig: string;
          };
          status: string;
          bls_aggr_pk: string;
          power_sum: string;
          lifecycle: any[];
        };
      }>;
      memo: string;
      timeout_height: string;
      extension_options: any[];
      non_critical_extension_options: any[];
    };
    auth_info: any;
    signatures: any[];
  }>;
}

export interface ValidatorResponse {
  validators: Array<{
    operator_address: string;
    consensus_pubkey: {
      key: string;
    };
    description: {
      moniker: string;
    };
    status: string;
    voting_power: string;
  }>;
  pagination: {
    total: string;
  };
}

export interface ServiceConstants {
  EPOCH_BLOCKS: number;
  BLOCK_ID_FLAG_COMMIT_STR: string;
}

export interface CheckpointValidator {
  moniker: string;
  operatorAddress: string;
  power: string;
} 