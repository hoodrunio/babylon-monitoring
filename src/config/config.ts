import dotenv from 'dotenv';
import path from 'path';

// Load .env file
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

export enum Network {
  MAINNET = 'mainnet',
  TESTNET = 'testnet',
}

export interface NetworkConfig {
  rpcUrls: string[];
  restUrls: string[];
  telegramBotToken?: string;
  telegramChatId?: string;
  pagerdutyIntegrationKey?: string;
}

export interface Config {
  mongodbUri: string;
  networks: Record<Network, NetworkConfig>;
  monitoringEnabled: boolean;
  finalityProviderMonitoringEnabled: boolean;
  validatorSignatureMonitoringEnabled: boolean;
  blsSignatureMonitoringEnabled: boolean;
  monitoringIntervalMs: number;
  finalizedBlocksWait: number;
  telegramEnabled: boolean;
  pagerdutyEnabled: boolean;
  trackedValidators: string[];
  trackedFinalityProviders: string[];
  validatorSignatureThreshold: number;
  finalityProviderSignatureThreshold: number;
  blsSignatureThreshold: number;
}

function getStringEnv(key: string, defaultValue: string = ''): string {
  return process.env[key] || defaultValue;
}

function getBooleanEnv(key: string, defaultValue: boolean = false): boolean {
  const value = process.env[key];
  if (value === undefined) return defaultValue;
  return value.toLowerCase() === 'true';
}

function getNumberEnv(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (value === undefined) return defaultValue;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

function getStringArrayEnv(key: string, defaultValue: string[] = []): string[] {
  const value = process.env[key];
  if (!value) return defaultValue;
  return value.split(',').map(item => item.trim()).filter(Boolean);
}

// Konfigürasyon nesnesi oluşturma
const config: Config = {
  mongodbUri: getStringEnv('MONGODB_URI', 'mongodb://localhost:27017/babylon-monitoring'),
  
  networks: {
    [Network.MAINNET]: {
      rpcUrls: getStringArrayEnv('MAINNET_RPC_URLS'),
      restUrls: getStringArrayEnv('MAINNET_REST_URLS'),
      telegramBotToken: getStringEnv('MAINNET_TELEGRAM_BOT_TOKEN'),
      telegramChatId: getStringEnv('MAINNET_TELEGRAM_CHAT_ID'),
      pagerdutyIntegrationKey: getStringEnv('MAINNET_PAGERDUTY_INTEGRATION_KEY'),
    },
    [Network.TESTNET]: {
      rpcUrls: getStringArrayEnv('TESTNET_RPC_URLS'),
      restUrls: getStringArrayEnv('TESTNET_REST_URLS'),
      telegramBotToken: getStringEnv('TESTNET_TELEGRAM_BOT_TOKEN'),
      telegramChatId: getStringEnv('TESTNET_TELEGRAM_CHAT_ID'),
      pagerdutyIntegrationKey: getStringEnv('TESTNET_PAGERDUTY_INTEGRATION_KEY'),
    },
  },
  
  monitoringEnabled: getBooleanEnv('MONITORING_ENABLED', true),
  finalityProviderMonitoringEnabled: getBooleanEnv('FINALITY_PROVIDER_MONITORING_ENABLED', true),
  validatorSignatureMonitoringEnabled: getBooleanEnv('VALIDATOR_SIGNATURE_MONITORING_ENABLED', true),
  blsSignatureMonitoringEnabled: getBooleanEnv('BLS_SIGNATURE_MONITORING_ENABLED', true),
  monitoringIntervalMs: getNumberEnv('MONITORING_INTERVAL_MS', 60000),
  finalizedBlocksWait: getNumberEnv('FINALIZED_BLOCKS_WAIT', 3),
  
  telegramEnabled: getBooleanEnv('TELEGRAM_ENABLED', false),
  pagerdutyEnabled: getBooleanEnv('PAGERDUTY_ENABLED', false),
  
  trackedValidators: getStringArrayEnv('TRACKED_VALIDATORS'),
  trackedFinalityProviders: getStringArrayEnv('TRACKED_FINALITY_PROVIDERS'),
  
  validatorSignatureThreshold: getNumberEnv('VALIDATOR_SIGNATURE_THRESHOLD', 90),
  finalityProviderSignatureThreshold: getNumberEnv('FINALITY_PROVIDER_SIGNATURE_THRESHOLD', 90),
  blsSignatureThreshold: getNumberEnv('BLS_SIGNATURE_THRESHOLD', 90),
};

export default config; 