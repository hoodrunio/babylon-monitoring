import { Network } from "../config/config";
import { BabylonClient } from "../clients/babylon-client.interface";

export interface MonitoringServiceOptions {
  enabled: boolean;
  network: Network;
  
  // Finality provider options
  signatureRateThreshold?: number;
  missedBlocksThreshold?: number;
  
  // Validator options
  trackMissedSignatures?: boolean;
  validatorSignatureThreshold?: number;
  
  // BLS signature options
  trackedAddresses?: string[];
  blockThreshold?: number;
}

export interface MonitoringService {
  initialize(client: BabylonClient, options: MonitoringServiceOptions): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  handleNewBlock(height: number): Promise<void>;
  isEnabled(): boolean;
  getName(): string;
  getNetwork(): Network;
} 