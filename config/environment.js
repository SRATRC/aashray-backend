import { config } from 'dotenv';
import { resolve } from 'path';
import logger from './logger.js';

const env = process.env.NODE_ENV || 'dev';
const envFilePath = resolve('./', `.env.${env}`);

logger.info(`Environment loaded: ${env}`);
logger.info(`Environment file: ${envFilePath}`);

config({ path: envFilePath });
