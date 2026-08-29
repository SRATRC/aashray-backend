import { config } from 'dotenv';
import { resolve } from 'path';

const env = process.env.NODE_ENV || 'dev';
const envFilePath = resolve('./', `.env.${env}`);

config({ path: envFilePath });

// Loaded without a top-level await: jest's globalSetup is CommonJS and
// `require()`s this module, and a top-level await makes that throw
// ERR_REQUIRE_ASYNC_MODULE — which stops the whole test suite from running.
import('./logger.js').then(({ default: logger }) => {
  logger.info(`Environment loaded: ${env}`);
  logger.info(`Environment file: ${envFilePath}`);
});

