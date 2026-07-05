import { config } from 'dotenv';
import { resolve } from 'path';

const env = process.env.NODE_ENV || 'dev';
const envFilePath = resolve('./', `.env.${env}`);

config({ path: envFilePath });

// logger.js reads process.env.LOG_DIR at module load time, so it must only
// be imported after the dotenv.config() call above has run. A top-level
// `await import('./logger.js')` previously enforced that ordering, but
// top-level await makes this module (and anything that imports it, e.g.
// app.js) unusable from Jest's CommonJS test transform
// (`ERR_REQUIRE_ASYNC_MODULE` / "await is only valid in async functions").
// A fire-and-forget dynamic import (no top-level `await`) keeps the same
// ordering guarantee — the import still can't start until this line runs,
// which is after dotenv.config() — without the syntax Jest's transform
// chokes on, so these two lines can go back through the structured logger
// instead of bypassing it via console.log.
import('./logger.js').then(({ default: logger }) => {
  logger.info(`Environment loaded: ${env}`);
  logger.info(`Environment file: ${envFilePath}`);
});
