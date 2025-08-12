import { NotificationService } from '../../services/notification.service.js';
import { Expo } from 'expo-server-sdk';

// Mock the Expo SDK
jest.mock('expo-server-sdk');

describe('NotificationService', () => {
  let notificationService;
  let mockExpo;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Create mock Expo instance
    mockExpo = {
      chunkPushNotifications: jest.fn(),
      sendPushNotificationsAsync: jest.fn(),
      chunkPushNotificationReceiptIds: jest.fn(),
      getPushNotificationReceiptsAsync: jest.fn()
    };

    // Mock Expo constructor and static methods
    Expo.mockImplementation(() => mockExpo);
    Expo.isExpoPushToken = jest.fn();

    notificationService = new NotificationService();
  });

  describe('sendPushNotifications', () => {
    it('should throw error for empty tokenData', async () => {
      await expect(notificationService.sendPushNotifications([])).rejects.toThrow(
        'tokenData must be a non-empty array'
      );
    });

    it('should throw error for non-array tokenData', async () => {
      await expect(notificationService.sendPushNotifications(null)).rejects.toThrow(
        'tokenData must be a non-empty array'
      );
    });

    it('should successfully send notifications with valid tokens', async () => {
      const tokenData = [
        {
          token: 'ExponentPushToken[valid-token-1]',
          title: 'Test Title',
          body: 'Test Body',
          screen: 'TestScreen'
        }
      ];

      // Mock Expo methods
      Expo.isExpoPushToken.mockReturnValue(true);
      mockExpo.chunkPushNotifications.mockReturnValue([
        [
          {
            to: 'ExponentPushToken[valid-token-1]',
            sound: 'default',
            title: 'Test Title',
            body: 'Test Body',
            data: { screen: 'TestScreen' }
          }
        ]
      ]);
      mockExpo.sendPushNotificationsAsync.mockResolvedValue([
        { id: 'ticket-id-1', status: 'ok' }
      ]);
      mockExpo.chunkPushNotificationReceiptIds.mockReturnValue([['ticket-id-1']]);
      mockExpo.getPushNotificationReceiptsAsync.mockResolvedValue({
        'ticket-id-1': { status: 'ok' }
      });

      const result = await notificationService.sendPushNotifications(tokenData);

      expect(result).toEqual({
        success: true,
        tickets: [{ id: 'ticket-id-1', status: 'ok' }],
        sentCount: 1,
        totalRequested: 1
      });

      expect(Expo.isExpoPushToken).toHaveBeenCalledWith('ExponentPushToken[valid-token-1]');
      expect(mockExpo.sendPushNotificationsAsync).toHaveBeenCalled();
    });

    it('should skip invalid tokens and continue with valid ones', async () => {
      const tokenData = [
        {
          token: 'invalid-token',
          title: 'Test Title',
          body: 'Test Body'
        },
        {
          token: 'ExponentPushToken[valid-token]',
          title: 'Test Title',
          body: 'Test Body'
        }
      ];

      // Mock first token as invalid, second as valid
      Expo.isExpoPushToken
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(true);

      mockExpo.chunkPushNotifications.mockReturnValue([
        [
          {
            to: 'ExponentPushToken[valid-token]',
            sound: 'default',
            title: 'Test Title',
            body: 'Test Body',
            data: { screen: '/' }
          }
        ]
      ]);
      mockExpo.sendPushNotificationsAsync.mockResolvedValue([
        { id: 'ticket-id-1', status: 'ok' }
      ]);
      mockExpo.chunkPushNotificationReceiptIds.mockReturnValue([['ticket-id-1']]);
      mockExpo.getPushNotificationReceiptsAsync.mockResolvedValue({
        'ticket-id-1': { status: 'ok' }
      });

      const result = await notificationService.sendPushNotifications(tokenData);

      expect(result.sentCount).toBe(1);
      expect(result.totalRequested).toBe(2);
      expect(Expo.isExpoPushToken).toHaveBeenCalledTimes(2);
    });

    it('should throw error when no valid tokens found', async () => {
      const tokenData = [
        {
          token: 'invalid-token',
          title: 'Test Title',
          body: 'Test Body'
        }
      ];

      Expo.isExpoPushToken.mockReturnValue(false);

      await expect(notificationService.sendPushNotifications(tokenData)).rejects.toThrow(
        'No valid push tokens found'
      );
    });
  });

  describe('sendSingleNotification', () => {
    it('should send notification to single recipient', async () => {
      const token = 'ExponentPushToken[valid-token]';
      const options = {
        title: 'Single Test',
        body: 'Single Body',
        screen: 'SingleScreen'
      };

      Expo.isExpoPushToken.mockReturnValue(true);
      mockExpo.chunkPushNotifications.mockReturnValue([
        [
          {
            to: token,
            sound: 'default',
            title: 'Single Test',
            body: 'Single Body',
            data: { screen: 'SingleScreen' }
          }
        ]
      ]);
      mockExpo.sendPushNotificationsAsync.mockResolvedValue([
        { id: 'ticket-id-1', status: 'ok' }
      ]);
      mockExpo.chunkPushNotificationReceiptIds.mockReturnValue([['ticket-id-1']]);
      mockExpo.getPushNotificationReceiptsAsync.mockResolvedValue({
        'ticket-id-1': { status: 'ok' }
      });

      const result = await notificationService.sendSingleNotification(token, options);

      expect(result.sentCount).toBe(1);
      expect(result.totalRequested).toBe(1);
    });
  });

  describe('sendBulkNotification', () => {
    it('should send same notification to multiple recipients', async () => {
      const tokens = ['ExponentPushToken[token-1]', 'ExponentPushToken[token-2]'];
      const notification = {
        title: 'Bulk Test',
        body: 'Bulk Body',
        screen: 'BulkScreen'
      };

      Expo.isExpoPushToken.mockReturnValue(true);
      mockExpo.chunkPushNotifications.mockReturnValue([
        [
          {
            to: 'ExponentPushToken[token-1]',
            sound: 'default',
            title: 'Bulk Test',
            body: 'Bulk Body',
            data: { screen: 'BulkScreen' }
          },
          {
            to: 'ExponentPushToken[token-2]',
            sound: 'default',
            title: 'Bulk Test',
            body: 'Bulk Body',
            data: { screen: 'BulkScreen' }
          }
        ]
      ]);
      mockExpo.sendPushNotificationsAsync.mockResolvedValue([
        { id: 'ticket-id-1', status: 'ok' },
        { id: 'ticket-id-2', status: 'ok' }
      ]);
      mockExpo.chunkPushNotificationReceiptIds.mockReturnValue([['ticket-id-1', 'ticket-id-2']]);
      mockExpo.getPushNotificationReceiptsAsync.mockResolvedValue({
        'ticket-id-1': { status: 'ok' },
        'ticket-id-2': { status: 'ok' }
      });

      const result = await notificationService.sendBulkNotification(tokens, notification);

      expect(result.sentCount).toBe(2);
      expect(result.totalRequested).toBe(2);
    });

    it('should throw error for empty tokens array', async () => {
      await expect(notificationService.sendBulkNotification([], {})).rejects.toThrow(
        'tokens must be a non-empty array'
      );
    });
  });

  describe('isValidPushToken', () => {
    it('should validate push tokens correctly', () => {
      Expo.isExpoPushToken.mockReturnValue(true);
      
      const result = notificationService.isValidPushToken('ExponentPushToken[valid]');
      
      expect(result).toBe(true);
      expect(Expo.isExpoPushToken).toHaveBeenCalledWith('ExponentPushToken[valid]');
    });
  });

  describe('getHealthStatus', () => {
    it('should return health status', () => {
      const status = notificationService.getHealthStatus();
      
      expect(status).toHaveProperty('service', 'NotificationService');
      expect(status).toHaveProperty('status', 'healthy');
      expect(status).toHaveProperty('expo');
      expect(status).toHaveProperty('timestamp');
    });
  });
});
