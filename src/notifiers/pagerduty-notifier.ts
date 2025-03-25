import axios from 'axios';
import logger from '../utils/logger';
import { AlertPayload, AlertSeverity, Notifier, NotifierOptions } from './notifier.interface';
import { Network } from '../config/config';

export interface PagerDutyNotifierOptions extends NotifierOptions {
  integrationKey: string;
}

export class PagerDutyNotifier implements Notifier {
  private options: PagerDutyNotifierOptions | null = null;
  private readonly EVENTS_API_URL = 'https://events.pagerduty.com/v2/enqueue';

  async initialize(options: PagerDutyNotifierOptions): Promise<void> {
    this.options = options;

    if (!options.enabled) {
      logger.info(`PagerDuty notifications disabled for ${options.network} network`);
      return;
    }

    if (!options.integrationKey) {
      logger.warn(`Missing integrationKey for PagerDuty notifications (${options.network})`);
      return;
    }

    logger.info(`PagerDuty notifier initialized for ${options.network} network`);
  }

  async sendAlert(alert: AlertPayload): Promise<boolean> {
    if (!this.isEnabled() || !this.options?.integrationKey) {
      return false;
    }

    try {
      const networkTag = `[${alert.network.toUpperCase()}]`;
      const payload = {
        routing_key: this.options.integrationKey,
        event_action: 'trigger',
        dedup_key: `${alert.network}-${alert.title.replace(/\s+/g, '-').toLowerCase()}-${new Date().toISOString().split('T')[0]}`,
        payload: {
          summary: `${networkTag} ${alert.title}`,
          source: 'Babylon Monitoring',
          severity: this.mapSeverity(alert.severity),
          timestamp: alert.timestamp.toISOString(),
          custom_details: {
            message: alert.message,
            ...alert.metadata
          }
        }
      };

      const response = await axios.post(this.EVENTS_API_URL, payload, {
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (response.status === 202) {
        logger.info({ alert: alert.title }, 'PagerDuty notification sent successfully');
        return true;
      } else {
        logger.warn({ status: response.status, response: response.data }, 'Unexpected response from PagerDuty notification');
        return false;
      }
    } catch (error) {
      logger.error({ error, alert }, 'Error sending PagerDuty notification');
      return false;
    }
  }

  private mapSeverity(severity: AlertSeverity): string {
    switch (severity) {
      case AlertSeverity.CRITICAL:
        return 'critical';
      case AlertSeverity.WARNING:
        return 'warning';
      case AlertSeverity.INFO:
      default:
        return 'info';
    }
  }

  isEnabled(): boolean {
    return this.options?.enabled === true;
  }

  getNetwork(): Network {
    return this.options?.network || Network.MAINNET;
  }
} 