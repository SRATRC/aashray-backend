import dotenv from 'dotenv';
dotenv.config({ path: '.env.dev' });

import { getPriorityOrderForMonth } from '../helpers/roomBooking.helper.js';

async function test() {
  console.log('--- Testing getPriorityOrderForMonth ---');
  const defaultOrder = await getPriorityOrderForMonth('2026-10-15');
  console.log('Default Priority Order for October 2026:', defaultOrder);

  console.log('Unit test passed!');
  process.exit(0);
}

test().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
