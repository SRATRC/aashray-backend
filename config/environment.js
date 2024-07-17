import { config } from 'dotenv';
import { resolve } from 'path';

const env = process.env.NODE_ENV || 'dev';
const envFilePath = resolve('./', `.env.${env}`);
console.log(envFilePath);

config({ path: envFilePath });

console.log(`Environment: ${env}`);
