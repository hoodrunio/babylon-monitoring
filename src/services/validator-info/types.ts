export interface ValidatorResponse {
  validators: Array<{
    operator_address: string;
    consensus_pubkey: {
      type?: string;
      key: string;
    };
    description: {
      moniker: string;
      details?: string;
      website?: string;
      identity?: string;
      security_contact?: string;
    };
    status: string;
    tokens: string;
    delegator_shares?: string;
    jailed?: boolean;
    unbonding_height?: string;
    unbonding_time?: string;
    commission: {
      commission_rates: {
        rate: string;
        max_rate: string;
        max_change_rate: string;
      };
      update_time: string;
    };
    min_self_delegation?: string;
  }>;
  pagination: {
    total: string;
    next_key: string | null;
  };
}

export interface ServiceConstants {
  UPDATE_INTERVAL: number;
} 