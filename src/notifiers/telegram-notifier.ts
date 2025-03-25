import TelegramBot from 'node-telegram-bot-api';
import logger from '../utils/logger';
import { AlertPayload, AlertSeverity, Notifier, NotifierOptions } from './notifier.interface';
import { Network } from '../config/config';

export interface TelegramNotifierOptions extends NotifierOptions {
  botToken: string;
  chatId: string;
}

export class TelegramNotifier implements Notifier {
  private bot: TelegramBot | null = null;
  private options: TelegramNotifierOptions | null = null;
  private severityEmoji = {
    [AlertSeverity.INFO]: 'ℹ️',
    [AlertSeverity.WARNING]: '⚠️',
    [AlertSeverity.CRITICAL]: '🚨',
  };

  async initialize(options: TelegramNotifierOptions): Promise<void> {
    this.options = options;

    if (!options.enabled) {
      logger.info(`Telegram notifications disabled for ${options.network} network`);
      return;
    }

    if (!options.botToken || !options.chatId) {
      logger.warn(`Missing botToken or chatId for Telegram notifications (${options.network})`);
      return;
    }

    try {
      this.bot = new TelegramBot(options.botToken, { polling: false });
      logger.info(`Telegram notifier initialized for ${options.network} network`);
    } catch (error) {
      logger.error({ error }, `Error creating Telegram bot (${options.network})`);
      throw error;
    }
  }

  async sendAlert(alert: AlertPayload): Promise<boolean> {
    if (!this.isEnabled() || !this.bot || !this.options?.chatId) {
      return false;
    }

    try {
      const emoji = this.severityEmoji[alert.severity];
      const networkTag = `[${alert.network.toUpperCase()}]`;
      const message = `${emoji} ${networkTag} ${alert.title}\n\n${alert.message}`;

      await this.bot.sendMessage(this.options.chatId, message, { parse_mode: 'Markdown' });
      return true;
    } catch (error) {
      logger.error({ error, alert }, 'Error sending Telegram notification');
      return false;
    }
  }

  isEnabled(): boolean {
    return this.options?.enabled === true;
  }

  getNetwork(): Network {
    return this.options?.network || Network.MAINNET;
  }
}