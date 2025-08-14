import { Expo } from 'expo-server-sdk';
import logger from '../config/logger.js';

/**
 * NotificationService - Centralized service for handling push notifications
 *
 * This service provides a unified interface for sending push notifications
 * using Expo's push notification service. It handles token validation,
 * message chunking, receipt processing, and error handling.
 */
class NotificationService {
  constructor() {
    this.expo = new Expo();
    this.config = {
      defaultSound: 'default',
      defaultTitle: 'Notification',
      defaultBody: 'This is a notification',
      receiptCheckDelay: 15000,
      maxRetries: 3
    };
  }

  /**
   * Send push notifications to multiple recipients
   * @param {Array} tokenData - Array of notification objects with token, title, body, etc.
   * @returns {Promise<Object>} - Returns success status, tickets, and sent count
   */
  async sendPushNotifications(tokenData) {
    if (!Array.isArray(tokenData) || tokenData.length === 0) {
      throw new Error('tokenData must be a non-empty array');
    }

    logger.info(`Attempting to send ${tokenData.length} push notifications`);

    const messages = this._buildMessages(tokenData);

    if (messages.length === 0) {
      throw new Error('No valid push tokens found');
    }

    logger.info(
      `Built ${messages.length} valid messages from ${tokenData.length} token data entries`
    );

    const chunks = this.expo.chunkPushNotifications(messages);
    const tickets = [];

    // Send notifications in chunks
    for (let chunk of chunks) {
      try {
        const ticketChunk = await this.expo.sendPushNotificationsAsync(chunk);
        tickets.push(...ticketChunk);
        logger.info(`Successfully sent chunk of ${chunk.length} notifications`);
      } catch (error) {
        logger.error('Error sending notification chunk:', error);
        throw error;
      }
    }

    // Process receipts for error checking
    await this._processReceipts(tickets);

    logger.info(
      `Successfully sent ${messages.length} notifications with ${tickets.length} tickets`
    );

    return {
      success: true,
      tickets,
      sentCount: messages.length,
      totalRequested: tokenData.length
    };
  }

  /**
   * Send a single notification to one recipient
   * @param {string} token - Push token
   * @param {Object} options - Notification options (title, body, sound, screen, data)
   * @returns {Promise<Object>} - Returns success status and tickets/error info
   */
  async sendSingleNotification(token, options = {}) {
    const tokenData = [
      {
        token,
        title: options.title,
        body: options.body,
        sound: options.sound || this.config.defaultSound,
        screen: options.screen,
        data: options.data
      }
    ];

    return await this.sendPushNotifications(tokenData);
  }

  /**
   * Send the same notification to multiple recipients
   * @param {Array} tokens - Array of push tokens
   * @param {Object} notification - Notification content (title, body, sound, screen, data)
   * @returns {Promise<Object>} - Returns success status and tickets/error info
   */
  async sendBulkNotification(tokens, notification) {
    if (!Array.isArray(tokens) || tokens.length === 0) {
      throw new Error('tokens must be a non-empty array');
    }

    const tokenData = tokens.map((token) => ({
      token,
      ...notification
    }));

    return await this.sendPushNotifications(tokenData);
  }

  /**
   * Build notification messages from token data
   * @private
   * @param {Array} tokenData - Array of notification data
   * @returns {Array} - Array of formatted messages
   */
  _buildMessages(tokenData) {
    const messages = [];

    for (let singleData of tokenData) {
      if (!singleData.token) {
        logger.warn('Skipping notification data without token');
        continue;
      }

      if (!Expo.isExpoPushToken(singleData.token)) {
        logger.error(
          `Push token ${singleData.token} is not a valid Expo push token`
        );
        continue;
      }

      messages.push({
        to: singleData.token,
        sound: singleData.sound || this.config.defaultSound,
        title: singleData.title || this.config.defaultTitle,
        body: singleData.body || this.config.defaultBody,
        data: { screen: singleData.screen || '/', ...singleData.data },
        priority: singleData.priority || 'default', // 'default' | 'normal' | 'high'
        badge: singleData.badge, // iOS badge number
        channelId: singleData.channelId, // Android channel
        categoryId: singleData.categoryId, // iOS category for actions
        mutableContent: singleData.mutableContent, // iOS mutable content
        ttl: singleData.ttl // Time to live in seconds
      });
    }

    return messages;
  }

  /**
   * Process notification receipts to check for errors
   * @private
   * @param {Array} tickets - Array of notification tickets
   */
  async _processReceipts(tickets) {
    const receiptIds = tickets
      .filter((ticket) => ticket.id)
      .map((ticket) => ticket.id);

    if (receiptIds.length === 0) {
      logger.warn('No receipt IDs found in tickets');
      return;
    }

    const receiptIdChunks =
      this.expo.chunkPushNotificationReceiptIds(receiptIds);

    for (let chunk of receiptIdChunks) {
      try {
        const receipts = await this.expo.getPushNotificationReceiptsAsync(
          chunk
        );

        for (let receiptId in receipts) {
          const { status, message, details } = receipts[receiptId];

          if (status === 'error') {
            logger.error(
              `Notification error for receipt ${receiptId}: ${message}`
            );

            if (details && details.error) {
              logger.error(`Error code: ${details.error}`);

              // Handle specific error types
              if (details.error === 'DeviceNotRegistered') {
                logger.warn(`Device token is no longer valid: ${receiptId}`);
              }
            }
          } else if (status === 'ok') {
            logger.debug(`Notification delivered successfully: ${receiptId}`);
          }
        }
      } catch (error) {
        logger.error('Error checking notification receipts:', error);
        // Don't throw here as this is just for monitoring
      }
    }
  }

  /**
   * Validate a push token
   * @param {string} token - Push token to validate
   * @returns {boolean} - True if token is valid
   */
  isValidPushToken(token) {
    return Expo.isExpoPushToken(token);
  }

  /**
   * Get service health status
   * @returns {Object} - Service health information
   */
  getHealthStatus() {
    return {
      service: 'NotificationService',
      status: 'healthy',
      expo: {
        available: !!this.expo,
        version: Expo.version || 'unknown'
      },
      timestamp: new Date().toISOString()
    };
  }
}

// Export singleton instance
const notificationService = new NotificationService();
export default notificationService;

// Also export the class for testing purposes
export { NotificationService };
