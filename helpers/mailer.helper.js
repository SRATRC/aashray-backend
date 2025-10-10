import { sendUnifiedEmail } from '../controllers/helper.js';
import { STATUS_CANCELLED, TYPE_ADHYAYAN, TYPE_UTSAV } from '../config/constants.js';
import { sendUtsavBookingUpdateEmail } from './utsavBooking.helper.js';
import { sendAdhyayanBookingUpdateEmail } from './adhyayanBooking.helper.js';
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

export async function sendOpenBookingEmail(openBookingIds, additionalParams = {}) {
  const emailActions = {
    [TYPE_UTSAV]: sendUtsavBookingUpdateEmail,
    [TYPE_ADHYAYAN]: sendAdhyayanBookingUpdateEmail
  };

  await Promise.all(
    Object.entries(openBookingIds).map(([bookingType, bookingIds]) => {
      const sendEmail = emailActions[bookingType];
      if (!sendEmail) return Promise.resolve();
      
      // Get additional params for this booking type (if any)
      const typeParams = additionalParams[bookingType] || {};
      
      return Promise.all(
        bookingIds.map(bookingId => sendEmail(bookingId, typeParams.adhyayan, typeParams.isFromAdmin))
      );
    })
  );
}