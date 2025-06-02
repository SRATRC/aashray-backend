import { Expo } from 'expo-server-sdk';

/**
 * Reusable function to send push notifications
 * Array of {token, title, body, ...}
 * @param {Array} tokenData - Array of notification objects with token, title, body, etc.
 * @returns {Promise<Object>} - Returns success status and tickets/error info
 */
export const sendPushNotifications = async (tokenData) => {
  if (!Array.isArray(tokenData) || tokenData.length === 0) {
    throw new Error('tokenData must be a non-empty array');
  }

  let expo = new Expo();
  let messages = [];

  for (let singleData of tokenData) {
    if (!Expo.isExpoPushToken(singleData.token)) {
      console.error(
        `Push token ${singleData.token} is not a valid Expo push token`
      );
      continue;
    }

    messages.push({
      to: singleData.token,
      sound: singleData.sound || 'default',
      title: singleData.title || 'Notification',
      body: singleData.body || 'This is a test notification',
      data: {
        screen: singleData.screen || '/',
        ...singleData.data
      }
    });
  }

  if (messages.length === 0) {
    throw new Error('No valid push tokens found');
  }

  let chunks = expo.chunkPushNotifications(messages);
  let tickets = [];

  for (let chunk of chunks) {
    try {
      let ticketChunk = await expo.sendPushNotificationsAsync(chunk);
      tickets.push(...ticketChunk);
    } catch (error) {
      console.error('Error sending notification chunk:', error);
      throw error;
    }
  }

  let receiptIds = tickets
    .filter((ticket) => ticket.id)
    .map((ticket) => ticket.id);

  if (receiptIds.length > 0) {
    let receiptIdChunks = expo.chunkPushNotificationReceiptIds(receiptIds);

    for (let chunk of receiptIdChunks) {
      try {
        let receipts = await expo.getPushNotificationReceiptsAsync(chunk);
        for (let receiptId in receipts) {
          let { status, message, details } = receipts[receiptId];
          if (status === 'error') {
            console.error(`Notification error: ${message}`);
            if (details && details.error) {
              console.error(`Error code: ${details.error}`);
            }
          }
        }
      } catch (error) {
        console.error('Error checking receipts:', error);
      }
    }
  }

  return {
    success: true,
    tickets,
    sentCount: messages.length
  };
};

/**
 * Helper function to send a single notification
 * Single token + options
 * @param {string} token - Push token
 * @param {Object} options - Notification options (title, body, sound, screen, data)
 * @returns {Promise<Object>} - Returns success status and tickets/error info
 */
export const sendSingleNotification = async (token, options = {}) => {
  const tokenData = [
    {
      token,
      title: options.title,
      body: options.body,
      sound: options.sound,
      screen: options.screen,
      data: options.data
    }
  ];

  return await sendPushNotifications(tokenData);
};

/**
 * Helper function to send notifications to multiple users with the same message
 * Array of tokens + one message
 * @param {Array} tokens - Array of push tokens
 * @param {Object} notification - Notification content (title, body, sound, screen, data)
 * @returns {Promise<Object>} - Returns success status and tickets/error info
 */
export const sendBulkNotification = async (tokens, notification) => {
  const tokenData = tokens.map((token) => ({
    token,
    ...notification
  }));

  return await sendPushNotifications(tokenData);
};
