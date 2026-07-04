import { config } from 'dotenv';
import { resolve } from 'path';

const env = process.env.NODE_ENV || 'dev';
const envFilePath = resolve('./', `.env.${env}`);

config({ path: envFilePath });

// Plain console.log here (not the winston logger): logger.js reads
// process.env.LOG_DIR at module load time, so it must only be imported
// (by this file's callers, further down the module graph) after the
// dotenv.config() call above has run. A top-level `await import('./logger.js')`
// was previously used to enforce that ordering, but top-level await makes this
// module (and anything that imports it, e.g. app.js) unusable from Jest's
// CommonJS test transform (`ERR_REQUIRE_ASYNC_MODULE` / "await is only valid
// in async functions"). Since dotenv.config() above is synchronous, ordering
// is already guaranteed without it.
console.log(`Environment loaded: ${env}`);
console.log(`Environment file: ${envFilePath}`);
