import { config } from 'dotenv';
import { resolve } from 'path';

const env = process.env.NODE_ENV || 'dev';
const envFilePath = resolve('./', `.env.${env}`);

config({ path: envFilePath });

const { default: logger } = await import('./logger.js');

logger.info(`Environment loaded: ${env}`);
logger.info(`Environment file: ${envFilePath}`);

