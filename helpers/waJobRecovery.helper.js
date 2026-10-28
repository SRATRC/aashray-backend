import { Op } from 'sequelize';
import { WaGroupJob } from '../models/associations.js';

// Recover jobs left in 'processing' (service crashed or restarted mid-job).
// One job runs at a time, so a job still 'processing' after the threshold is stuck.
// attempts was already counted when the job started: at 3 it fails, below 3 it goes back to pending.
export const STUCK_JOB_MINUTES = 10;
export const MAX_JOB_ATTEMPTS = 3;
export async function recoverStuckJobs() {
  try {
    const cutoff = new Date(Date.now() - STUCK_JOB_MINUTES * 60 * 1000);
    const stuck = { status: 'processing', updatedAt: { [Op.lt]: cutoff } };
    const [failed] = await WaGroupJob.update(
      { status: 'failed', error: 'Service stopped while processing this job' },
      { where: { ...stuck, attempts: { [Op.gte]: MAX_JOB_ATTEMPTS } } }
    );
    const [requeued] = await WaGroupJob.update({ status: 'pending' }, { where: stuck });
    if (failed || requeued) {
      console.log(`[WA Service] Recovered stuck jobs: ${requeued} re-queued, ${failed} marked failed.`);
    }
  } catch (err) {
    console.error('[WA Service] Stuck job recovery failed:', err.message);
  }
}
