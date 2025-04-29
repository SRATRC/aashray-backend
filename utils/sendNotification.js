import { Expo } from 'expo-server-sdk';

const expo = new Expo();

export const sendNotification = async (tokenData) => {
  let messages = [];

  for (let singleData of tokenData) {
    if (!Expo.isExpoPushToken(singleData.token)) {
      console.error(`Invalid Expo token: ${singleData.token}`);
      continue;
    }

    messages.push({
      to: singleData.token,
      sound: singleData.sound || 'default',
      title: singleData.title || 'Notification',
      body: singleData.body || '',
      data: {
        screen: singleData.screen || '/',
        ...singleData.data
      }
    });
  }

  const chunks = expo.chunkPushNotifications(messages);
  const tickets = [];

  for (let chunk of chunks) {
    try {
      const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
      tickets.push(...ticketChunk);
    } catch (error) {
      console.error('Error sending notification chunk:', error);
    }
  }

  return tickets;
};
