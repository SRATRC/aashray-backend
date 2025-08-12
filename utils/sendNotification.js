import notificationService from '../services/notification.service.js';

/**
 * @deprecated This utility function is deprecated.
 * Use notificationService.sendPushNotifications() directly instead.
 * This wrapper is maintained for backward compatibility only.
 *
 * @param {Array} tokenData - Array of notification objects with token, title, body, etc.
 * @returns {Promise<Array>} - Returns array of tickets (for backward compatibility)
 */
export const sendNotification = async (tokenData) => {
  console.warn(
    'DEPRECATED: utils/sendNotification.js is deprecated. Use notificationService from services/notification.service.js instead.'
  );

  try {
    const result = await notificationService.sendPushNotifications(tokenData);
    // Return just tickets for backward compatibility
    return result.tickets;
  } catch (error) {
    console.error('Error in deprecated sendNotification:', error);
    throw error;
  }
};
