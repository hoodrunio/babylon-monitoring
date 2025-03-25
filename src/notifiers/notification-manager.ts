import logger from '../utils/logger';
import config, { Network } from '../config/config';
import { AlertPayload, Notifier } from './notifier.interface';
import { TelegramNotifier } from './telegram-notifier';
import { PagerDutyNotifier } from './pagerduty-notifier';

export class NotificationManager {
  private notifiers: Map<Network, Notifier[]> = new Map();

  async initialize(): Promise<void> {
    // Initialize Mainnet notifiers
    await this.initializeNetworkNotifiers(Network.MAINNET);

    // Initialize Testnet notifiers
    await this.initializeNetworkNotifiers(Network.TESTNET);

    logger.info('NotificationManager initialized');
  }

  private async initializeNetworkNotifiers(network: Network): Promise<void> {
    const networkNotifiers: Notifier[] = [];
    const networkConfig = config.networks[network];

    // Telegram
    if (config.telegramEnabled && networkConfig.telegramBotToken && networkConfig.telegramChatId) {
      const telegramNotifier = new TelegramNotifier();
      await telegramNotifier.initialize({
        enabled: config.telegramEnabled,
        network,
        botToken: networkConfig.telegramBotToken,
        chatId: networkConfig.telegramChatId
      });
      networkNotifiers.push(telegramNotifier);
    }

    // PagerDuty
    if (config.pagerdutyEnabled && networkConfig.pagerdutyIntegrationKey) {
      const pagerdutyNotifier = new PagerDutyNotifier();
      await pagerdutyNotifier.initialize({
        enabled: config.pagerdutyEnabled,
        network,
        integrationKey: networkConfig.pagerdutyIntegrationKey
      });
      networkNotifiers.push(pagerdutyNotifier);
    }

    this.notifiers.set(network, networkNotifiers);
    logger.info(`${network} network için ${networkNotifiers.length} notification services initialized`);
  }

  async sendAlert(alert: AlertPayload): Promise<void> {
    const network = alert.network;
    const networkNotifiers = this.notifiers.get(network) || [];

    if (networkNotifiers.length === 0) {
      logger.warn(`No notification services found for ${network} network, cannot send notification`);
      return;
    }

    logger.info({ alert: alert.title, network }, 'Sending notification');

    const sendPromises = networkNotifiers.map(notifier => 
      notifier.sendAlert(alert)
        .then(success => ({ notifier, success }))
        .catch(error => {
          logger.error({ error, notifier: notifier.constructor.name }, 'Notification sending error');
          return { notifier, success: false };
        })
    );

    const results = await Promise.all(sendPromises);
    const successCount = results.filter(r => r.success).length;

    logger.info(`${successCount}/${networkNotifiers.length} notification services used successfully`);
  }
}

// Singleton instance
const notificationManager = new NotificationManager();
export default notificationManager;