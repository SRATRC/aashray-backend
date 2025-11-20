import { sendUnifiedEmail } from '../controllers/helper.js';
import { STATUS_CANCELLED, TYPE_ADHYAYAN, TYPE_UTSAV, TYPE_TRAVEL } from '../config/constants.js';
import { sendUtsavBookingUpdateEmail } from './utsavBooking.helper.js';
import { sendAdhyayanBookingUpdateNotification } from './adhyayanBooking.helper.js';
import { sendTravelBookingStatusUpdateMail } from './travelBooking.helper.js';
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

export async function sendOpenBookingEmail(bookingType, openBookings) {
  const emailActions = {
    [TYPE_UTSAV]: sendUtsavBookingUpdateEmail,
    [TYPE_ADHYAYAN]: sendAdhyayanBookingUpdateNotification,
    [TYPE_TRAVEL]: sendTravelBookingStatusUpdateMail
  };

  const sendEmail = emailActions[bookingType];
  
  if (sendEmail && Array.isArray(openBookings)) {
    await Promise.all(openBookings.map(booking => sendEmail(booking)));
  } else {
    console.log('No email function found for bookingType:', bookingType, 'or openBookings is not an array:', openBookings);
  }
}