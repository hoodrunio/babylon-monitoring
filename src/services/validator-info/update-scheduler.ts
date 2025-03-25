import logger from '../../utils/logger';
import { Network } from '../../config/config';
import { ServiceConstants } from './types';

/**
 * Class for scheduling periodic validator information updates
 */
export class UpdateScheduler {
  private updateTimer: NodeJS.Timeout | null = null;
  
  constructor(
    private readonly constants: ServiceConstants,
    private readonly network: Network,
    private readonly updateCallback: () => Promise<void>
  ) {}

  /**
   * Starts the periodic update scheduler
   */
  startPeriodicUpdates(): void {
    if (this.updateTimer) {
      this.clearScheduler();
    }
    
    this.updateTimer = setInterval(async () => {
      try {
        logger.info(`Scheduled validator information update starting for ${this.network}...`);
        await this.updateCallback();
        logger.info(`Scheduled validator information update completed for ${this.network}`);
      } catch (error) {
        logger.error({ error, network: this.network }, 'Error in scheduled validator information update');
      }
    }, this.constants.UPDATE_INTERVAL);
    
    const minutes = this.constants.UPDATE_INTERVAL / (60 * 1000);
    logger.info(`Validator information will be updated every ${minutes} minutes for ${this.network}`);
  }

  /**
   * Clears the update scheduler
   */
  clearScheduler(): void {
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = null;
      logger.debug(`Validator information update scheduler cleared for ${this.network}`);
    }
  }

  /**
   * Checks if the scheduler is active
   */
  isSchedulerActive(): boolean {
    return this.updateTimer !== null;
  }

  /**
   * Returns the update interval in milliseconds
   */
  getUpdateInterval(): number {
    return this.constants.UPDATE_INTERVAL;
  }
} 