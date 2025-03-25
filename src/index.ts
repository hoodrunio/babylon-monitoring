import logger from './utils/logger';
import config, { Network } from './config/config';
import mongodb from './database/mongodb';
import notificationManager from './notifiers/notification-manager';
import { BabylonClientImpl } from './clients/babylon-client';
import { WebSocketManager } from './clients/websocket-manager';
import { ValidatorSignatureService } from './services/validator-signature';
import { FinalityProviderService } from './services/finality-provider';
import { BLSSignatureService } from './services/bls-signature';
import { MonitoringService } from './services/monitoring-service.interface';
import validatorInfoService from './services/validator-info-service';

// Monitoring services
const monitoringServices = new Map<Network, MonitoringService[]>();

async function initialize(): Promise<void> {
  try {
    logger.info('Babylon Monitoring starting...');

    // MongoDB connection start
    await mongodb.connect();

    // Notification manager start
    await notificationManager.initialize();
    
    // Test notification system
    await testNotifications();

    // Start network-based services
    await initializeNetworkServices(Network.MAINNET);
    await initializeNetworkServices(Network.TESTNET);

    logger.info('Babylon Monitoring started successfully');
  } catch (error) {
    logger.error({ error }, 'Error occurred while starting Babylon Monitoring');
    process.exit(1);
  }
}

async function initializeNetworkServices(network: Network): Promise<void> {
  const networkConfig = config.networks[network];
  const services: MonitoringService[] = [];
  let finalityProviderService: FinalityProviderService | null = null;
  let validatorSignatureService: ValidatorSignatureService | null = null;
  let blsSignatureService: BLSSignatureService | null = null;

  try {
    logger.info(`Starting monitoring services for ${network} network...`);
    
    // Client create
    const client = new BabylonClientImpl();
    await client.initialize({
      network,
      rpcUrls: networkConfig.rpcUrls,
      restUrls: networkConfig.restUrls
    });
    
    // Start ValidatorInfoService
    await validatorInfoService.initialize(client, {
      enabled: true,
      network,
      trackedAddresses: config.trackedValidators,
      blockThreshold: config.validatorSignatureThreshold
    });
    services.push(validatorInfoService);
    logger.info(`${network} network ValidatorInfoService started`);
    
    // Start Finality provider signature monitoring service
    if (config.finalityProviderMonitoringEnabled) {
      finalityProviderService = new FinalityProviderService();
      await finalityProviderService.initialize(client, {
        enabled: config.finalityProviderMonitoringEnabled,
        network,
        trackedAddresses: config.trackedFinalityProviders,
        blockThreshold: config.finalityProviderSignatureThreshold
      });
      services.push(finalityProviderService);
      logger.info(`${network} network FinalityProviderService started`);
    }
    
    // Start Validator signature monitoring service
    if (config.validatorSignatureMonitoringEnabled) {
      validatorSignatureService = new ValidatorSignatureService();
      await validatorSignatureService.initialize(client, {
        enabled: config.validatorSignatureMonitoringEnabled,
        network,
        trackedAddresses: config.trackedValidators,
        blockThreshold: config.validatorSignatureThreshold
      });
      services.push(validatorSignatureService);
      logger.info(`${network} network ValidatorSignatureService started`);
    }
    
    // Start BLS signature monitoring service
    if (config.blsSignatureMonitoringEnabled) {
      blsSignatureService = new BLSSignatureService();
      await blsSignatureService.initialize(client, {
        enabled: config.blsSignatureMonitoringEnabled,
        network,
        trackedAddresses: config.trackedValidators,
        blockThreshold: config.blsSignatureThreshold
      });
      services.push(blsSignatureService);
      logger.info(`${network} network BLSSignatureService started`);
    }

    // Start services
    for (const service of services) {
      await service.start();
    }

    // Create WebSocket manager and start block listening
    // BLS checkpoint callback is also added
    const wsManager = new WebSocketManager(
      client, 
      async (height: number) => {
        await handleNewBlock(network, height, services);
      },
      // WebSocket block callback for ValidatorSignature
      validatorSignatureService ?
        async (blockData: any) => {
          if (validatorSignatureService) {
            await validatorSignatureService.handleWebSocketBlock(blockData);
          }
        } :
        undefined,
      // Callback for BLS checkpoint events
      blsSignatureService ? 
        async (epochNum: number) => {
          if (blsSignatureService) {
            await blsSignatureService.handleBLSCheckpoint(epochNum);
          }
        } : 
        undefined
    );
    
    await wsManager.start();

    // Store services
    monitoringServices.set(network, services);

    logger.info(`${network} network ${services.length} monitoring services started`);
  } catch (error) {
    logger.error({ error }, `Error occurred while starting monitoring services for ${network} network`);
  }
}

async function handleNewBlock(network: Network, height: number, services: MonitoringService[]): Promise<void> {
  logger.info(`Processing new block: ${network} - ${height}`);
  
  for (const service of services) {
    if (service.isEnabled()) {
      try {
        await service.handleNewBlock(height);
      } catch (error) {
        logger.error({ error, service: service.getName(), height }, 'Error occurred while processing block');
      }
    }
  }
}

// Helper function to test notifications
async function testNotifications(): Promise<void> {
  logger.info('Testing notification system...');
  
  // Check notification configuration
  if (!config.telegramEnabled && !config.pagerdutyEnabled) {
    logger.warn('WARNING: Notification systems (Telegram, PagerDuty) are disabled. Check .env file.');
  }
  
  // Telegram test
  if (config.telegramEnabled) {
    for (const network of [Network.MAINNET, Network.TESTNET]) {
      const networkConfig = config.networks[network];
      if (!networkConfig.telegramBotToken || !networkConfig.telegramChatId) {
        logger.warn(`WARNING: Telegram botToken or chatId not defined for ${network}!`);
      } else {
        logger.info(`Telegram notifications active for ${network}`);
      }
    }
  }
  
  // PagerDuty test
  if (config.pagerdutyEnabled) {
    for (const network of [Network.MAINNET, Network.TESTNET]) {
      const networkConfig = config.networks[network];
      if (!networkConfig.pagerdutyIntegrationKey) {
        logger.warn(`WARNING: PagerDuty integrationKey not defined for ${network}!`);
      } else {
        logger.info(`PagerDuty notifications active for ${network}`);
      }
    }
  }
  
  // Test notification sending
  /*
  const testAlert: AlertPayload = {
    title: 'Test Notification',
    message: 'This is a test notification. Notification system is working.',
    severity: AlertSeverity.INFO,
    network: Network.MAINNET,
    timestamp: new Date(),
    metadata: {}
  };
  
  await notificationManager.sendAlert(testAlert);
  */
}

// Initialize application
initialize();

// Clean up application on exit
process.on('SIGINT', async () => {
  logger.info('SIGINT signal received, shutting down application...');
  await shutdown();
});

process.on('SIGTERM', async () => {
  logger.info('SIGTERM signal received, shutting down application...');
  await shutdown();
});

async function shutdown(): Promise<void> {
  try {
    // Stop all services
    for (const [network, services] of monitoringServices.entries()) {
      for (const service of services) {
        await service.stop();
      }
      logger.info(`${network} network monitoring services stopped`);
    }

    // Close MongoDB connection
    await mongodb.disconnect();

    logger.info('Application shut down successfully');
    process.exit(0);
  } catch (error) {
    logger.error({ error }, 'Error occurred while shutting down application');
    process.exit(1);
  }
}