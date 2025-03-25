import { Network } from '../config/config';

export interface BLSValidatorSignature {
  epochNum: number;
  validatorAddress: string;
  validatorMoniker: string;
  validatorOperatorAddress: string;
  validatorPower: string;
  signed: boolean;
  voteExtension?: string;
  extensionSignature?: string;
  network: Network;
  timestamp: Date;
}

export interface BLSCheckpointStats {
  epochNum: number;
  network: Network;
  totalValidators: number;
  totalPower: string;
  signedPower: string;
  unsignedPower: string;
  participationRateByCount: string;
  participationRateByPower: string;
  timestamp: Date;
} 