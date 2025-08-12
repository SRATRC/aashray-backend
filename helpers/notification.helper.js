import notificationService from '../services/notification.service.js';

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
