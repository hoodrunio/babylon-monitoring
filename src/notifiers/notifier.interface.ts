import { Network } from "../config/config";

export enum AlertSeverity {
  INFO = 'info',
  WARNING = 'warning',
  CRITICAL = 'critical'
}

export interface AlertPayload {
  title: string;
  message: string;
  severity: AlertSeverity;
  network: Network;
  timestamp: Date;
  metadata?: Record<string, any>;
}

export interface NotifierOptions {
  enabled: boolean;
  network: Network;
  [key: string]: any;
}

export interface Notifier {
  initialize(options: NotifierOptions): Promise<void>;
  sendAlert(alert: AlertPayload): Promise<boolean>;
  isEnabled(): boolean;
  getNetwork(): Network;
} 