export const sendNotification = async (req, res) => {
  const { tokenData } = req.body;

  let expo = new Expo();
  let messages = [];

  for (let singleData of tokenData) {
    if (!Expo.isExpoPushToken(singleData.token)) {
      console.error(
        `Push token ${singleData.token} is not a valid Expo push token`
      );
      continue;
    }

    // Include screen navigation data in the notification
    messages.push({
      to: singleData.token,
      sound: singleData.sound || 'default',
      title: singleData.title || 'Notification',
      body: singleData.body || 'This is a test notification',
      data: {
        screen: singleData.screen || '/', // Add the screen route you want to navigate to
        ...singleData.data // Include any additional data
      }
    });
  }

  let chunks = expo.chunkPushNotifications(messages);
  let tickets = [];

  try {
    // Send notifications and wait for the results
    for (let chunk of chunks) {
      try {
        let ticketChunk = await expo.sendPushNotificationsAsync(chunk);
        tickets.push(...ticketChunk);
      } catch (error) {
        console.error('Error sending notification chunk:', error);
      }
    }

    // Process receipts
    let receiptIds = tickets
      .filter((ticket) => ticket.id)
      .map((ticket) => ticket.id);
    let receiptIdChunks = expo.chunkPushNotificationReceiptIds(receiptIds);

    // Check receipts
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

    return res.status(200).json({
      message: 'Notifications sent successfully',
      tickets
    });
  } catch (error) {
    console.error('Error in notification process:', error);
    return res.status(500).json({
      message: 'Error sending notifications',
      error: error.message
    });
  }
};
