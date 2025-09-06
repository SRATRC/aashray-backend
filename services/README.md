# Services Directory

This directory contains reusable service classes that encapsulate business logic and can be used across different parts of the application.

## NotificationService

The `NotificationService` provides a centralized, robust solution for sending push notifications using Expo's push notification service.

### Features

- **Centralized Logic**: All notification functionality in one place
- **Error Handling**: Comprehensive error handling and logging
- **Token Validation**: Automatic validation of Expo push tokens
- **Receipt Processing**: Automatic processing of notification receipts
- **Rate Limiting by Default**: Per-second throttling to avoid service overload
- **Chunking**: Automatic chunking of large notification batches
- **Logging**: Detailed logging for monitoring and debugging
- **Health Monitoring**: Built-in health status reporting

### Usage

#### Basic Import

```javascript
import notificationService from '../services/notification.service.js';
```

#### Send Multiple Notifications

```javascript
const tokenData = [
  {
    token: 'ExponentPushToken[user1-token]',
    title: 'Welcome!',
    body: 'Thanks for joining our app',
    screen: 'Home',
    data: { userId: '123' }
  },
  {
    token: 'ExponentPushToken[user2-token]',
    title: 'New Message',
    body: 'You have a new message',
    screen: 'Messages',
    data: { messageId: '456' }
  }
];

try {
  const result = await notificationService.sendPushNotifications(tokenData);
  console.log(`Sent ${result.sentCount} notifications successfully`);
} catch (error) {
  console.error('Failed to send notifications:', error);
}
```

#### Send Single Notification

```javascript
try {
  const result = await notificationService.sendSingleNotification(
    'ExponentPushToken[user-token]',
    {
      title: 'Booking Confirmed',
      body: 'Your booking has been confirmed',
      screen: 'BookingDetails',
      sound: 'default',
      data: { bookingId: '789' }
    }
  );
  console.log('Notification sent successfully');
} catch (error) {
  console.error('Failed to send notification:', error);
}
```

#### Send Bulk Notification (Same Message to Multiple Users)

```javascript
const tokens = [
  'ExponentPushToken[user1-token]',
  'ExponentPushToken[user2-token]',
  'ExponentPushToken[user3-token]'
];

const notification = {
  title: 'System Maintenance',
  body: 'The system will be down for maintenance at 2 AM',
  screen: 'Announcements',
  data: { type: 'maintenance' }
};

try {
  // Unified API: tokens signature
  const result = await notificationService.sendPushNotifications(
    tokens,
    notification
  );
  console.log(`Sent notification to ${result.sentCount} users`);
} catch (error) {
  console.error('Failed to send bulk notification:', error);
}
```

### API Reference

#### `sendPushNotifications(...)` (Unified bulk sender, rate-limited by default)

Sends push notifications in bulk with automatic per-second rate limiting and payload chunking.

Supported signatures:

- `sendPushNotifications(tokenData, options?)`
- `sendPushNotifications(tokens, notification, options?)`

**Parameters:**

- `tokenData` (Array): Array of notification objects

**Notification Object Structure:**

```javascript
{
  token: 'ExponentPushToken[...]',    // Required: Expo push token
  title: 'Notification Title',        // Optional: defaults to 'Notification'
  body: 'Notification body text',     // Optional: defaults to 'This is a notification'
  sound: 'default',                   // Optional: defaults to 'default'
  screen: 'TargetScreen',             // Optional: defaults to '/'
  data: { key: 'value' }              // Optional: additional data
}
```

- or `tokens` (Array<string>): array of tokens + one shared `notification` object
- `options` (Object): { ratePerSecond?: number, retries?: number }

**Returns:**

```javascript
{
  success: true,
  tickets: [...],
  sentCount: 5,
  totalRequested: 6
}
```

#### `sendSingleNotification(token, options)`

Sends a single notification to one recipient.

**Parameters:**

- `token` (String): Expo push token
- `options` (Object): Notification options

**Returns:** Same as `sendPushNotifications`

#### `isValidPushToken(token)`

Validates an Expo push token.

**Parameters:**

- `token` (String): Token to validate

**Returns:** Boolean

#### `getHealthStatus()`

Returns service health information.

**Returns:**

```javascript
{
  service: 'NotificationService',
  status: 'healthy',
  expo: {
    available: true,
    version: '...'
  },
  timestamp: '2025-08-12T...'
}
```

### Error Handling

The service handles various error scenarios:

- **Invalid tokens**: Automatically skipped with logging
- **Network errors**: Proper error propagation
- **Empty data**: Validation with meaningful error messages
- **Receipt errors**: Logged but don't fail the operation

### Migration from Legacy Code

#### From `utils/sendNotification.js`

**Old:**

```javascript
import { sendNotification } from '../utils/sendNotification.js';
const tickets = await sendNotification(tokenData);
```

**New:**

```javascript
import notificationService from '../services/notification.service.js';
const result = await notificationService.sendPushNotifications(tokenData);
const tickets = result.tickets; // If you need just tickets
```

### Migration from Legacy Code

All legacy helper wrappers and alternative bulk methods have been removed. Use only the unified API:

```javascript
import notificationService from '../services/notification.service.js';
// Either pass pre-built tokenData
await notificationService.sendPushNotifications(tokenData);
// Or pass tokens + shared notification content
await notificationService.sendPushNotifications(tokens, notification);
```

### Best Practices

1. **Always handle errors**: Wrap notification calls in try-catch blocks
2. **Don't fail operations**: If notifications fail, log the error but don't fail the main operation
3. **Validate tokens**: Use `isValidPushToken()` if you need to validate tokens beforehand
4. **Monitor health**: Use `getHealthStatus()` for health checks
5. **Use appropriate method**: Choose between `sendPushNotifications` (bulk) and `sendSingleNotification` (single) based on your use case

### Testing

The service includes comprehensive tests. Run them with:

```bash
npm test -- tests/services/notification.service.test.js
```

### Logging

The service uses the application's logger and provides detailed logs:

- **Info**: Successful operations and counts
- **Error**: Failed operations and invalid tokens
- **Debug**: Receipt processing details
- **Warn**: Non-critical issues
