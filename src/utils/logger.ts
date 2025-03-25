import pino from 'pino';
import dotenv from 'dotenv';

dotenv.config();

const logger = pino({
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
    },
  },
  level: process.env.LOG_LEVEL || 'info',
});

export default logger; 