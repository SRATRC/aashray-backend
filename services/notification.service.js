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
      maxRetries: 3,
      ratePerSecond: 600,
      chunkSize: 100
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
   * Send notifications (bulk or pre-built) with rate limiting by default
   * Backward compatible: accepts either (tokens, notification, options?) or (tokenData, options?)
   * @param {Array} arg1 - Array of tokens OR array of pre-built tokenData objects
   * @param {Object} [arg2] - Notification content if arg1 is tokens OR options if arg1 is tokenData
   * @param {Object} [arg3] - Options when arg1 is tokens
   * @returns {Promise<Object>} - Result object with success, tickets, counts
   */
  async sendBulkNotification(arg1, arg2 = undefined, arg3 = undefined) {
    let tokenData;
    let options;

    if (
      Array.isArray(arg1) &&
      (arg1.length === 0 || typeof arg1[0] === 'string')
    ) {
      // Signature: (tokens, notification, options?)
      const tokens = arg1;
      const notification = arg2 || {};
      options = arg3 || {};

      if (!Array.isArray(tokens) || tokens.length === 0) {
        throw new Error('tokens must be a non-empty array');
      }

      tokenData = tokens.map((token) => ({ token, ...notification }));
    } else if (Array.isArray(arg1)) {
      // Signature: (tokenData, options?)
      tokenData = arg1;
      options = arg2 || {};
      if (!Array.isArray(tokenData) || tokenData.length === 0) {
        throw new Error('tokenData must be a non-empty array');
      }
    } else {
      throw new Error('Invalid arguments to sendBulkNotification');
    }

    // Default to rate limited sending
    return await this.sendPushNotificationsRateLimited(tokenData, options);
  }

  /**
   * Core send with rate limiting (per-second throttle) and retries
   * @param {Array} tokenData - Array of notification objects with token, title, body, etc.
   * @param {Object} options - { ratePerSecond?: number, retries?: number, delayMs?: number }
   */
  async sendPushNotificationsRateLimited(tokenData, options = {}) {
    const ratePerSecond = options.ratePerSecond || this.config.ratePerSecond;
    const retries = options.retries || this.config.maxRetries;

    if (!Array.isArray(tokenData) || tokenData.length === 0) {
      throw new Error('tokenData must be a non-empty array');
    }

    const messages = this._buildMessages(tokenData);
    if (messages.length === 0) {
      throw new Error('No valid push tokens found');
    }

    // Group messages into per-second buckets respecting rate limit
    const buckets = [];
    for (let i = 0; i < messages.length; i += ratePerSecond) {
      buckets.push(messages.slice(i, i + ratePerSecond));
    }

    const allTickets = [];

    // Helper to send a chunk with basic retry
    const sendChunkWithRetry = async (chunk) => {
      let attempt = 0;
      while (attempt <= retries) {
        try {
          const ticketChunk = await this.expo.sendPushNotificationsAsync(chunk);
          return ticketChunk;
        } catch (err) {
          attempt += 1;
          logger.error(`Rate-limited send failed (attempt ${attempt}):`, err);
          if (attempt > retries) throw err;
          await new Promise((res) => setTimeout(res, 1000 * attempt));
        }
      }
    };

    for (let b = 0; b < buckets.length; b++) {
      const bucket = buckets[b];
      // Expo recommends chunking for payload size; chunk into ~100
      const chunks = this.expo.chunkPushNotifications(bucket);
      for (const chunk of chunks) {
        const tickets = await sendChunkWithRetry(chunk);
        allTickets.push(...tickets);
        logger.info(`Sent ${chunk.length} notifications in throttled mode`);
      }
      if (b < buckets.length - 1) {
        // Wait 1 second between buckets to respect 600/sec limit
        await new Promise((res) => setTimeout(res, 1000));
      }
    }

    await this._processReceipts(allTickets);

    return {
      success: true,
      tickets: allTickets,
      sentCount: messages.length,
      totalRequested: tokenData.length
    };
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
