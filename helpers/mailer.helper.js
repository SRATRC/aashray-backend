import { sendUnifiedEmail } from '../controllers/helper.js';
import sendMail from '../utils/sendMail.js';
import { BOOKING_STATUS_CANCEL } from '../config/constants.js';

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
    BOOKING_STATUS_CANCEL,
    'unifiedCancellationEmail'
  );
}

