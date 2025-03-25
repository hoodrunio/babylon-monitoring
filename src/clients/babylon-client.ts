import axios from 'axios';
import logger from '../utils/logger';
import { BabylonClient, BabylonClientOptions } from './babylon-client.interface';
import { Network } from '../config/config';

export class BabylonClientImpl implements BabylonClient {
  private options: BabylonClientOptions | null = null;
  private nodeUrlIndex = 0;
  private restUrlIndex = 0;
  private connected = false;

  async initialize(options: BabylonClientOptions): Promise<void> {
    if (options.rpcUrls.length === 0) {
      throw new Error(`RPC URLs are not defined for ${options.network} network`);
    }

    if (options.restUrls.length === 0) {
      throw new Error(`REST URLs are not defined for ${options.network} network`);
    }

    this.options = options;
    this.nodeUrlIndex = 0;
    this.restUrlIndex = 0;

    try {
      await this.checkConnection();
      logger.info(`Babylon client connected to ${options.network} network: ${this.getNodeUrl()}`);
    } catch (error) {
      logger.error({ error }, `Babylon client failed to connect to ${options.network} network`);
      throw error;
    }
  }

  getNodeUrl(): string {
    if (!this.options) {
      throw new Error('Babylon client is not initialized yet');
    }
    return this.options.rpcUrls[this.nodeUrlIndex];
  }

  getRestUrl(): string {
    if (!this.options) {
      throw new Error('Babylon client is not initialized yet');
    }
    return this.options.restUrls[this.restUrlIndex];
  }

  getWsUrl(): string {
    const nodeUrl = this.getNodeUrl();
    if (nodeUrl.startsWith('https://')) {
      return nodeUrl.replace('https://', 'wss://');
    } else if (nodeUrl.startsWith('http://')) {
      return nodeUrl.replace('http://', 'ws://');
    }
    return nodeUrl;
  }

  rotateNodeUrl(): string {
    if (!this.options) {
      throw new Error('Babylon client is not initialized yet');
    }
    this.nodeUrlIndex = (this.nodeUrlIndex + 1) % this.options.rpcUrls.length;
    logger.info(`RPC URL changed: ${this.getNodeUrl()}`);
    return this.getNodeUrl();
  }

  rotateRestUrl(): string {
    if (!this.options) {
      throw new Error('Babylon client is not initialized yet');
    }
    this.restUrlIndex = (this.restUrlIndex + 1) % this.options.restUrls.length;
    logger.info(`REST URL changed: ${this.getRestUrl()}`);
    return this.getRestUrl();
  }

  async checkConnection(): Promise<boolean> {
    try {
      const response = await axios.get(`${this.getNodeUrl()}/status`);
      this.connected = response.status === 200;
      return this.connected;
    } catch (error) {
      logger.error({ error }, `Babylon node connection error: ${this.getNodeUrl()}`);

      // Switch to the next node
      this.rotateNodeUrl();

      // If still fails after trying all nodes
      if (this.nodeUrlIndex === 0) {
        this.connected = false;
        throw new Error(`Could not connect to any Babylon node: ${this.options?.network}`);
      }

      // Recursively try the next node
      return this.checkConnection();
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  getNetwork(): Network {
    if (!this.options) {
      throw new Error('Babylon client is not initialized yet');
    }
    return this.options.network;
  }

  async getCurrentHeight(): Promise<number> {
    try {
      // Get the latest block information
      const response = await this.makeRestRequest<{ block: { header: { height: string } } }>(
        '/cosmos/base/tendermint/v1beta1/blocks/latest'
      );

      // Convert height to number
      const height = parseInt(response.block.header.height);

      if (isNaN(height)) {
        throw new Error('Invalid block height');
      }

      return height;
    } catch (error) {
      logger.error({ error }, 'Error getting latest block height');
      throw error;
    }
  }

  // Helper method for API requests
  async makeRpcRequest<T>(path: string, params?: any, method: string = 'GET'): Promise<T> {
    if (!this.isConnected()) {
      await this.checkConnection();
    }

    const url = `${this.getNodeUrl()}${path}`;
    try {
      let response;
      if (method === 'GET') {
        response = await axios.get(url, { params });
      } else if (method === 'POST') {
        response = await axios.post(url, params);
      } else {
        throw new Error(`Unsupported HTTP method: ${method}`);
      }
      return response.data as T;
    } catch (error) {
      logger.error({ error, url, params }, 'RPC request failed');

      // Switch to next node and try again
      this.rotateNodeUrl();
      return this.makeRpcRequest(path, params, method);
    }
  }

  // Helper method for REST API requests
  async makeRestRequest<T>(path: string, params?: any, method: string = 'GET'): Promise<T> {
    if (!this.isConnected()) {
      await this.checkConnection();
    }

    const url = `${this.getRestUrl()}${path}`;
    try {
      let response;
      if (method === 'GET') {
        response = await axios.get(url, { params });
      } else if (method === 'POST') {
        response = await axios.post(url, params);
      } else {
        throw new Error(`Unsupported HTTP method: ${method}`);
      }
      return response.data as T;
    } catch (error) {
      logger.error({ error, url, params }, 'REST request failed');

      // Switch to next REST URL and try again
      this.rotateRestUrl();
      return this.makeRestRequest(path, params, method);
    }
  }
}