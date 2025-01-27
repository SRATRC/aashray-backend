import { CardDb } from '../../models/associations.js';
import { Expo } from 'expo-server-sdk';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import axios from 'axios';
import FormData from 'form-data';
import Transactions from '../../models/transactions.model.js';
import ApiError from '../../utils/ApiError.js';

const FASTAPI_URL = 'http://127.0.0.1:3001/verify';

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
  const uploadDir = 'uploads/';
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }

  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
      cb(
        null,
        file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname)
      );
    }
  });

  const fileFilter = (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new ApiError(400, 'Only image files are allowed!'), false);
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

    const formData = new FormData();

    const fileStream = fs.createReadStream(req.file.path);
    formData.append('file', fileStream);

    const fastapiResponse = await axios.post(FASTAPI_URL, formData, {
      headers: {
        ...formData.getHeaders(),
        'Content-Type': 'multipart/form-data'
      }
    });

    if (fastapiResponse.data.isHumanFace) {
      // Save the file to the database or perform additional processing
      return res.status(200).json({
        message: 'File uploaded and verified successfully',
        file: req.file
      });
    } else {
      // Delete the file if verification fails
      fs.unlinkSync(req.file.path);
      // throw new ApiError(400, 'Face not found in the image');
      return res.status(400).json({ message: 'Face not found in the image' });
    }
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
