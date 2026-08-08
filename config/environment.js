import { config } from 'dotenv';
import { resolve } from 'path';

const env = process.env.NODE_ENV || 'dev';
const envFilePath = resolve('./', `.env.${env}`);

config({ path: envFilePath });

console.log(`Environment loaded: ${env}`);
console.log(`Environment file: ${envFilePath}`);
