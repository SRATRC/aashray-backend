import { sendUnifiedEmail } from '../controllers/helper.js';
import { STATUS_CANCELLED } from '../config/constants.js';

export async function sendCancellationEmail(
  cardno,
  bookingIds,
  bookedBy
) 
{
  await sendUnifiedEmail(
    cardno,
    bookingIds,
    bookedBy,
    STATUS_CANCELLED,
    'unifiedCancellationEmail'
  );
}

