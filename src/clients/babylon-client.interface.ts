import { Network } from '../config/config';

export interface BabylonClientOptions {
  network: Network;
  rpcUrls: string[];
  restUrls: string[];
}

export interface BabylonClient {
  initialize(options: BabylonClientOptions): Promise<void>;
  getNodeUrl(): string;
  getRestUrl(): string;
  getWsUrl(): string;
  rotateNodeUrl(): string;
  isConnected(): boolean;
  getNetwork(): Network;
  makeRpcRequest<T>(path: string, params?: any, method?: string): Promise<T>;
  makeRestRequest<T>(path: string, params?: any, method?: string): Promise<T>;
  getCurrentHeight(): Promise<number>;
} 