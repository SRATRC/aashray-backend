import { sendUnifiedEmail } from '../controllers/helper.js';
import sendMail from '../utils/sendMail.js';


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
    'Vitraag Vigyaan Aashray: Bookings Cancelled',
    'unifiedCancellationEmail'
  );
}

