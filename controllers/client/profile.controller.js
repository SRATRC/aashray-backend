import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand
} from '@aws-sdk/client-s3';
import { CardDb, Transactions } from '../../models/associations.js';
import { Expo } from 'expo-server-sdk';
import ApiError from '../../utils/ApiError.js';
import multer from 'multer';
import path from 'path';

export const updateProfile = async (req, res) => {
  const {
    issuedto,
    gender,
    dob,
    address,
    mobno,
    email,
    country,
    state,
    city,
    pin,
    centre
  } = req.body;
  const updatedProfile = await CardDb.update(
    {
      issuedto,
      gender,
      dob,
      address,
      mobno,
      email,
      country,
      state,
      city,
      pin,
      center: centre
    },
    {
      where: {
        cardno: req.user.cardno
      }
    }
  );
  if (!updatedProfile) {
    throw new ApiError(404, 'user not updated');
  }

  const updatedProfileData = await CardDb.findOne({
    where: {
      cardno: req.user.cardno
    },
    attributes: {
      exclude: ['id', 'createdAt', 'updatedAt', 'updatedBy']
    }
  });

  return res
    .status(200)
    .send({ message: 'Profile Updated', data: updatedProfileData });
};

export const upload = async (req, res) => {
  const doesPfpExist = req.user.pfp;

  const s3 = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
  });

  const storage = multer.memoryStorage();
  const fileFilter = (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  };

  const uploadSingle = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: { fileSize: 3 * 1024 * 1024 } // 3MB limit
  }).single('image');

  uploadSingle(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ error: `Multer error: ${err.message}` });
    } else if (err) {
      return res.status(400).json({ error: err.message });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'Please upload an image file' });
    }

    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const fileName = `${uniqueSuffix}${path.extname(req.file.originalname)}`;

    const uploadParams = {
      Bucket: process.env.AWS_S3_BUCKET_NAME,
      Key: fileName,
      Body: req.file.buffer,
      ContentType: req.file.mimetype
    };

    await s3.send(new PutObjectCommand(uploadParams));
    const fileUrl = `https://${process.env.AWS_S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileName}`;

    await CardDb.update(
      {
        pfp: fileUrl
      },
      {
        where: {
          cardno: req.user.cardno
        }
      }
    );

    if (doesPfpExist) {
      const oldKey = doesPfpExist.split('/').pop();
      const deleteParams = {
        Bucket: process.env.AWS_S3_BUCKET_NAME,
        Key: oldKey
      };

      await s3.send(new DeleteObjectCommand(deleteParams));
    }

    return res.status(200).json({
      message: 'File uploaded successfully',
      data: fileUrl
    });
  });
};

export const transactions = async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.page_size) || 10;
  const offset = (page - 1) * pageSize;
  const status = req.query.status.toLowerCase() || 'all';

  const whereClause = {
    cardno: req.user.cardno
  };

  if (status != 'all') {
    whereClause.status = status;
  }

  if (req.query.category) {
    whereClause.category = req.query.category;
  }

  const transactions = await Transactions.findAll({
    where: whereClause,
    attributes: {
      exclude: [
        'id',
        'cardno',
        'description',
        'upi_ref',
        'updatedAt',
        'updatedBy'
      ]
    },
    order: [['createdAt', 'DESC']],
    offset,
    limit: pageSize
  });
  return res
    .status(200)
    .send({ message: 'fetched transactions', data: transactions });
};

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
