import { Network } from '../config/config';
import { ValidatorInfo } from './validator-info.model';

export interface ValidatorSignatureStats {
  validatorAddress: string; // operator_address (valoper)
  validator?: ValidatorInfo; // Populated from validator_info collection
  totalSignedBlocks: number;
  totalBlocksInWindow: number;
  signatureRate: number;
  consecutiveSigned: number;
  consecutiveMissed: number;
  network: Network;
  recentBlocks: {
    blockHeight: number;
    signed: boolean;
    round: number;
    timestamp: Date;
  }[];
  lastUpdated: Date;
} 