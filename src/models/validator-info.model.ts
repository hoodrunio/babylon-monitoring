import { Document } from 'mongodb';
import { Network } from '../config/config';

export interface ValidatorInfo extends Document {
  validator_address: string;

  validator_hex_address: string;

  operator_address: string;

  consensus_pubkey: {
    type?: string;
    key: string;
  };

  moniker: string;

  description?: {
    details?: string;
    website?: string;
    identity?: string;
    security_contact?: string;
  };

  tokens: string;

  voting_power: string;

  commission?: {
    rate: string;
    max_rate: string;
    max_change_rate: string;
  };

  status: string;

  network: Network;

  alternative_addresses?: {
    bech32?: string[];
    hex?: string[];
  };

  last_updated: Date;
}