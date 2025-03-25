import WebSocket from 'ws';
import logger from '../utils/logger';
import { BabylonClient } from './babylon-client.interface';

export type NewBlockCallback = (height: number) => Promise<void>;
export type WebSocketBlockCallback = (blockData: any) => Promise<void>;
export type BLSCheckpointCallback = (epochNum: number) => Promise<void>;

export class WebSocketManager {
  private websocket: WebSocket | null = null;
  private client: BabylonClient;
  private newBlockCallback: NewBlockCallback;
  private webSocketBlockCallback: WebSocketBlockCallback | null = null;
  private blsCheckpointCallback: BLSCheckpointCallback | null = null;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private readonly MAX_RECONNECT_ATTEMPTS = 10;
  private readonly INITIAL_RECONNECT_DELAY = 1000; // 1 second
  private debugLogCount = 0;

  constructor(
    client: BabylonClient,
    newBlockCallback: NewBlockCallback,
    webSocketBlockCallback?: WebSocketBlockCallback,
    blsCheckpointCallback?: BLSCheckpointCallback
  ) {
    this.client = client;
    this.newBlockCallback = newBlockCallback;
    this.webSocketBlockCallback = webSocketBlockCallback || null;
    this.blsCheckpointCallback = blsCheckpointCallback || null;
  }

  async start(): Promise<void> {
    this.connect();
  }

  async stop(): Promise<void> {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.websocket) {
      this.websocket.terminate();
      this.websocket = null;
    }

    logger.info('WebSocket connection closed');
  }

  private connect(): void {
    try {
      const wsUrl = this.client.getWsUrl();
      logger.info(`Connecting to WebSocket: ${wsUrl}`);

      this.websocket = new WebSocket(`${wsUrl}/websocket`);

      this.websocket.on('open', () => this.onOpen());
      this.websocket.on('message', (data) => this.onMessage(data));
      this.websocket.on('error', (error) => this.onError(error));
      this.websocket.on('close', () => this.onClose());
    } catch (error) {
      logger.error({ error }, 'Error while connecting to WebSocket');
      this.scheduleReconnect();
    }
  }

  private onOpen(): void {
    logger.info('WebSocket connection opened');
    this.reconnectAttempts = 0;

    // Subscribe to NewBlock events
    const subscribeNewBlockMsg = JSON.stringify({
      jsonrpc: '2.0',
      method: 'subscribe',
      id: 'newBlock',
      params: ["tm.event='NewBlock'"]  // Tendermint format
    });

    if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
      this.websocket.send(subscribeNewBlockMsg);
      logger.info('Subscribed to NewBlock events');
    }

    // Subscribe to BLS checkpoint sealed events (if blsCheckpointCallback is provided)
    if (this.blsCheckpointCallback && this.websocket && this.websocket.readyState === WebSocket.OPEN) {
      const subscribeBLSCheckpointMsg = JSON.stringify({
        jsonrpc: '2.0',
        method: 'subscribe',
        id: 'checkpoint_for_bls',
        params: ["tm.event='Tx' AND babylon.checkpointing.v1.EventCheckpointSealed.checkpoint CONTAINS 'epoch_num'"]
      });

      this.websocket.send(subscribeBLSCheckpointMsg);
      logger.info('Subscribed to BLS checkpoint sealed events');
    }
  }

  private onMessage(data: WebSocket.Data): void {
    try {
      const messageStr = data.toString();
      const message = JSON.parse(messageStr);

      // Add debug log - show details of the first few messages
      if (this.debugLogCount < 5) {
        logger.debug({
          message: JSON.stringify(message, null, 2).substring(0, 500),
          hasId: !!message.id,
          hasResult: !!message.result
        }, 'WebSocket message details');
        this.debugLogCount++;
      }

      // Handle subscription confirmation messages - check only ID
      if (message.id === 'newBlock' && message.result && message.result === true) {
        logger.debug(`${message.id} subscription successful`);
        return;
      }

      if (message.id === 'checkpoint_for_bls' && message.result && message.result === true) {
        logger.debug(`${message.id} subscription successful`);
        return;
      }

      // Process block events
      if (message.result && message.result.data && message.result.data.value &&
          message.result.data.value.block && message.result.data.value.block.header) {

        const blockData = message.result.data.value;
        const blockHeight = parseInt(blockData.block.header.height, 10);

        if (!isNaN(blockHeight)) {
          // Log block structure for advanced debugging
          if (this.debugLogCount < 10) {
            logger.debug({
              height: blockHeight,
              hasLastCommit: !!blockData.block.last_commit,
              signatureCount: blockData.block.last_commit?.signatures?.length
            }, 'Block structure details');

            // Log signatures
            if (blockData.block.last_commit?.signatures) {
              const signatures = blockData.block.last_commit.signatures;
              const sampleSignature = signatures.length > 0 ? signatures[0] : null;
              logger.debug({
                sampleSignature,
                signatureKeys: sampleSignature ? Object.keys(sampleSignature) : []
              }, 'Signature example');
            }
          }

          logger.info(`New block detected: ${blockHeight}`);

          // Forward WebSocket block data directly to ValidatorSignatureService
          if (this.webSocketBlockCallback) {
            try {
              this.webSocketBlockCallback(blockData);
            } catch (error) {
              logger.error({ error, height: blockHeight }, 'Error processing WebSocket block data');
            }
          }

          // Call the normal block callback
          this.processNewBlock(blockHeight);
        }
      }

      // Process BLS Checkpoint sealed events - log the structure of events in more detail
      if (message.result && message.result.data && message.result.data.value &&
          message.result.data.value.events) {

        const events = message.result.data.value.events;
        logger.debug({ eventKeys: Object.keys(events) }, 'WebSocket events received');

        // Find BLS checkpoint sealed event
        const checkpointEventKey = Object.keys(events).find(key =>
          key.includes('checkpoint') || key.includes('EventCheckpointSealed') || key.includes('epoch_num')
        );

        if (checkpointEventKey) {
          logger.debug({ eventKey: checkpointEventKey, events: events[checkpointEventKey] }, 'Checkpoint event data');

          const checkpointEvents = events[checkpointEventKey];

          for (const event of checkpointEvents) {
            logger.debug({ event }, 'Event content');

            if (typeof event === 'string' && event.includes('epoch_num')) {
              // Extract epoch_num value
              const epochNumMatch = event.match(/epoch_num=(\d+)/);
              if (epochNumMatch && epochNumMatch[1]) {
                const epochNum = parseInt(epochNumMatch[1], 10);
                if (!isNaN(epochNum)) {
                  logger.info(`BLS Checkpoint sealed event detected, epoch: ${epochNum}`);
                  this.processBLSCheckpoint(epochNum);
                }
              }
            }
          }
        }
      }
    } catch (error) {
      logger.error({ error, data: data.toString().substring(0, 200) }, 'Error processing WebSocket message');
    }
  }

  private onError(error: Error): void {
    logger.error({ error }, 'Error in WebSocket connection');
  }

  private onClose(): void {
    logger.warn('WebSocket connection closed');
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }

    this.reconnectAttempts++;

    if (this.reconnectAttempts > this.MAX_RECONNECT_ATTEMPTS) {
      logger.error(`Maximum reconnection attempts exceeded (${this.MAX_RECONNECT_ATTEMPTS})`);

      // Change node URL and try again
      this.client.rotateNodeUrl();
      this.reconnectAttempts = 0;
    }

    const delay = this.INITIAL_RECONNECT_DELAY * Math.min(10, Math.pow(2, this.reconnectAttempts - 1));
    logger.info(`WebSocket reconnection attempt ${this.reconnectAttempts}, after ${delay}ms`);

    this.reconnectTimeout = setTimeout(() => {
      this.connect();
    }, delay);
  }

  private async processNewBlock(height: number): Promise<void> {
    try {
      logger.debug(`Starting to process new block: ${height}`);
      if (this.newBlockCallback) {
        await this.newBlockCallback(height);
        logger.debug(`New block processed successfully: ${height}`);
      } else {
        logger.warn('newBlockCallback not defined, block not processed');
      }
    } catch (error) {
      logger.error({ error, height }, 'Error processing new block');
    }
  }

  private async processBLSCheckpoint(epochNum: number): Promise<void> {
    try {
      logger.debug(`Starting to process BLS checkpoint: epoch ${epochNum}`);
      if (this.blsCheckpointCallback) {
        await this.blsCheckpointCallback(epochNum);
        logger.debug(`BLS checkpoint processed successfully: epoch ${epochNum}`);
      } else {
        logger.debug('blsCheckpointCallback not defined, checkpoint not processed');
      }
    } catch (error) {
      logger.error({ error, epochNum }, 'Error processing BLS checkpoint');
    }
  }
}