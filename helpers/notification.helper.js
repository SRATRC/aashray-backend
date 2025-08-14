import { CardDb } from '../models/associations.js';
import notificationService from '../services/notification.service.js';
import logger from '../config/logger.js';

/**
 * Reusable function to send push notifications
 * Array of {token, title, body, ...}
 * @param {Array} tokenData - Array of notification objects with token, title, body, etc.
 * @returns {Promise<Object>} - Returns success status and tickets/error info
 * @deprecated Use notificationService.sendPushNotifications() directly instead
 */
export const sendPushNotifications = async (tokenData) => {
  return await notificationService.sendPushNotifications(tokenData);
};

/**
 * Helper function to send a single notification
 * Single token + options
 * @param {string} token - Push token
 * @param {Object} options - Notification options (title, body, sound, screen, data)
 * @returns {Promise<Object>} - Returns success status and tickets/error info
 * @deprecated Use notificationService.sendSingleNotification() directly instead
 */
export const sendSingleNotification = async (token, options = {}) => {
  return await notificationService.sendSingleNotification(token, options);
};

/**
 * Helper function to send notifications to multiple users with the same message
 * Array of tokens + one message
 * @param {Array} tokens - Array of push tokens
 * @param {Object} notification - Notification content (title, body, sound, screen, data)
 * @returns {Promise<Object>} - Returns success status and tickets/error info
 * @deprecated Use notificationService.sendBulkNotification() directly instead
 */
export const sendBulkNotification = async (tokens, notification) => {
  return await notificationService.sendBulkNotification(tokens, notification);
};

/**
 * Send notifications to a primary user and, optionally, the "booked by" user.
 * - Looks up the bookedBy user's token using CardDb when a card number is provided
 * - Sends notifications via notificationService to one or both users, if tokens exist
 * - Handles logging and error handling internally; does not throw
 *
 * @param {Object} params
 * @param {Object} [params.primary] - Primary recipient notification
 * @param {string} [params.primary.token] - Expo push token for the primary user
 * @param {string} [params.primary.cardno] - Card number of the primary user (token will be looked up)
 * @param {string} [params.primary.title] - Notification title for the primary user
 * @param {string} [params.primary.body] - Notification body for the primary user
 * @param {Object} [params.bookedBy] - Booked-by recipient lookup + notification
 * @param {string} [params.bookedBy.cardno] - Card number of the booked-by user (token will be looked up)
 * @param {string} [params.bookedBy.title] - Notification title for the booked-by user
 * @param {string} [params.bookedBy.body] - Notification body for the booked-by user
 * @param {string} [params.screen] - Screen/deeplink to include in notification data
 * @param {Object} [params.data] - Additional data payload
 * @returns {Promise<{success: boolean, sentCount?: number, totalRequested?: number}>}
 */
export async function sendDualUserNotifications(params = {}) {
  const { primary, bookedBy, screen = '/home', data = {} } = params;

  try {
    const tokenData = [];

    // Primary user notification (direct token or lookup by cardno)
    if (primary) {
      if (primary.token) {
        tokenData.push({
          token: primary.token,
          title: primary.title,
          body: primary.body,
          screen,
          data
        });
      } else if (primary.cardno) {
        try {
          const primaryCard = await CardDb.findOne({
            where: { cardno: primary.cardno },
            attributes: ['token']
          });
          if (primaryCard?.token) {
            tokenData.push({
              token: primaryCard.token,
              title: primary.title,
              body: primary.body,
              screen,
              data
            });
          } else {
            logger.info(
              `No push token found for primary cardno=${primary.cardno}; skipping primary notification`
            );
          }
        } catch (lookupErr) {
          logger.error(
            `Error looking up primary token for cardno=${primary.cardno}: ${lookupErr}`
          );
        }
      }
    }

    // Booked-by user notification (lookup token by cardno)
    if (bookedBy?.cardno) {
      try {
        const bookedByCard = await CardDb.findOne({
          where: { cardno: bookedBy.cardno },
          attributes: ['token']
        });
        if (bookedByCard?.token) {
          tokenData.push({
            token: bookedByCard.token,
            title: bookedBy.title,
            body: bookedBy.body,
            screen,
            data
          });
        } else {
          logger.info(
            `No push token found for bookedBy cardno=${bookedBy.cardno}; skipping bookedBy notification`
          );
        }
      } catch (lookupErr) {
        logger.error(
          `Error looking up bookedBy token for cardno=${bookedBy.cardno}: ${lookupErr}`
        );
      }
    }

    if (tokenData.length === 0) {
      logger.warn(
        'No tokens available to send notifications; skipping push send'
      );
      return { success: false, totalRequested: 0, sentCount: 0 };
    }

    const result = await notificationService.sendPushNotifications(tokenData);
    logger.info(`Sent ${result.sentCount} notifications successfully`);
    return {
      success: true,
      sentCount: result.sentCount,
      totalRequested: result.totalRequested
    };
  } catch (error) {
    logger.error(`Failed to send dual-user notifications: ${error}`);
    return { success: false };
  }
}

/**
 * Pure utility: given a booking and the canceller's cardno, return the other user's cardno.
 * - Returns null if no bookedBy relationship or canceller not part of the booking.
 * @param {Object} booking
 * @param {string} cancellerCardno
 * @returns {string|null}
 */
export function getOtherBookingUser(booking, cancellerCardno) {
  if (!booking || !booking.bookedBy) return null;
  const isPrimary = cancellerCardno === booking.cardno;
  const isBookedBy = cancellerCardno === booking.bookedBy;
  if (!isPrimary && !isBookedBy) return null;
  return isPrimary ? booking.bookedBy : booking.cardno;
}

/**
 * Notify a single user identified by cardno.
 * - Looks up CardDb for a push token
 * - Uses the non-deprecated notificationService APIs
 * - Handles errors and logs appropriately
 *
 * @param {string} cardno
 * @param {{ title: string, body: string, screen?: string, data?: object, sound?: string }} notificationData
 * @returns {Promise<{ success: boolean, reason?: string }>} A success indicator
 */
export async function notifyCardno(cardno, notificationData = {}) {
  try {
    if (!cardno) {
      logger.warn('notifyCardno called without cardno');
      return { success: false, reason: 'missing_cardno' };
    }

    const card = await CardDb.findOne({
      where: { cardno },
      attributes: ['token']
    });
    if (!card?.token) {
      logger.info(
        `No push token found for cardno=${cardno}; skipping notification`
      );
      return { success: false, reason: 'no_token' };
    }

    const { title, body, screen, data, sound } = notificationData;
    if (!title || !body) {
      logger.warn('notifyCardno called without title/body');
      return { success: false, reason: 'invalid_payload' };
    }

    await notificationService.sendSingleNotification(card.token, {
      title,
      body,
      screen,
      data,
      sound
    });

    logger.info(`Notification sent to cardno=${cardno}`);
    return { success: true };
  } catch (err) {
    logger.error(`notifyCardno failed for cardno=${cardno}: ${err}`);
    return { success: false, reason: 'error' };
  }
}

export default {
  sendDualUserNotifications
};
