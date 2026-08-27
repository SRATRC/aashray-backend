import { config } from 'dotenv';
import { resolve } from 'path';

const env = process.env.NODE_ENV || 'dev';
const envFilePath = resolve('./', `.env.${env}`);

config({ path: envFilePath });

// logger.js reads the variables this file just loaded, so it cannot be a static
// import. Awaiting the dynamic one at the top level made this an async module,
// which jest's CJS globalSetup cannot require - ERR_REQUIRE_ASYNC_MODULE stops
// the whole suite. Two banner lines need not block module evaluation.
import('./logger.js')
  .then(({ default: logger }) => {
    logger.info(`Environment loaded: ${env}`);
    logger.info(`Environment file: ${envFilePath}`);
  })
  .catch((err) => {
    console.error('Failed to load logger for environment banner:', err);
  });
