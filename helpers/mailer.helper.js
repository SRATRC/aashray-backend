import { sendUnifiedEmail } from '../controllers/helper.js';
import { STATUS_CANCELLED, TYPE_ADHYAYAN, TYPE_UTSAV } from '../config/constants.js';
import { sendUtsavBookingUpdateEmail } from './utsavBooking.helper.js';
import { sendAdhyayanBookingUpdateNotification } from './adhyayanBooking.helper.js';
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

export async function sendOpenBookingEmail(openBookingIds) {
  const emailActions = {
    [TYPE_UTSAV]: sendUtsavBookingUpdateEmail,
    [TYPE_ADHYAYAN]: sendAdhyayanBookingUpdateNotification
  };

  await Promise.all(
    Object.entries(openBookingIds).map(([bookingType, bookingIds]) => {
      const sendEmail = emailActions[bookingType];
      return sendEmail ? Promise.all(bookingIds.map(sendEmail)) : Promise.resolve();
    })
  );
}