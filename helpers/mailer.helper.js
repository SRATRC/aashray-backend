import { sendUnifiedEmail } from '../controllers/helper.js';
import { STATUS_CANCELLED, TYPE_ADHYAYAN, TYPE_UTSAV, TYPE_TRAVEL } from '../config/constants.js';
import { sendUtsavBookingUpdateEmail } from './utsavBooking.helper.js';
import { sendAdhyayanBookingUpdateNotification } from './adhyayanBooking.helper.js';
import { sendTravelBookingStatusUpdateMail } from './travelBooking.helper.js';
import logger from '../config/logger.js';
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
    'unifiedCancellationEmail',
    false
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
    logger.warn('send_open_booking_email_skipped', { bookingType, isArray: Array.isArray(openBookings), count: openBookings?.length });
  }
}