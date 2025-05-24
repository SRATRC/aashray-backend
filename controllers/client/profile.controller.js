import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand
} from '@aws-sdk/client-s3';
import { CardDb, Transactions } from '../../models/associations.js';
import { Expo } from 'expo-server-sdk';
import database from '../../config/database.js';
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
    center
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
      center: center
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
      exclude: ['id', 'cardno', 'upi_ref', 'updatedAt', 'updatedBy']
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

export const fetchProfile = async (req, res) => {
  const { cardno } = req.body;

  const profile = await CardDb.findOne({
    where: {
      cardno: cardno
    },
    attributes: {
      exclude: [
        'id',
        'token',
        'active',
        'status',
        'createdAt',
        'updatedAt',
        'updatedBy'
      ]
    }
  });

  if (!profile) {
    throw new ApiError(404, 'user not found');
  }

  return res.status(200).json({ message: 'Profile fetched', data: profile });
};

export const fetchPendingTransactions = async (req, res) => {
  const transactions = await database.query(
    `SELECT combined.bookingid,
       combined.booked_for,
       combined.booked_by,
       combined.start_day,
       combined.end_day,
       combined.name,
       card_db.issuedto AS booked_by_name,
       transactions.amount,
       transactions.category
FROM
  (-- Room Bookings
 SELECT t1.bookingid,
        t1.cardno AS booked_for,
        t1.bookedBy AS booked_by,
        t1.checkin AS start_day,
        t1.checkout AS end_day,
        NULL AS name
   FROM room_booking t1
   UNION ALL -- Travel Bookings
 SELECT t2.bookingid,
        t2.cardno AS booked_for,
        t2.bookedBy AS booked_by,
        t2.date AS start_day,
        NULL AS end_day,
        NULL AS name
   FROM travel_db t2
   UNION ALL -- Shibir Bookings
 SELECT t3.bookingid,
        t3.cardno AS booked_for,
        t3.bookedBy AS booked_by,
        t4.start_date AS start_day,
        t4.end_date AS end_day,
        t4.name
   FROM shibir_booking_db t3
   LEFT JOIN shibir_db t4 ON t3.shibir_id = t4.id
   UNION ALL -- Utsav Bookings
 SELECT t5.bookingid,
        t5.cardno AS booked_for,
        t5.bookedBy AS booked_by,
        t6.start_date AS start_day,
        t6.end_date AS end_day,
        t7.name
   FROM utsav_booking t5
   LEFT JOIN utsav_packages_db t6 ON t5.packageid = t6.id
   LEFT JOIN utsav_db t7 ON t5.utsavid = t7.id) AS combined -- Only include transactions that are pending
INNER JOIN transactions ON combined.bookingid = transactions.bookingid
AND transactions.status IN ('pending', 'failed', 'cash pending') -- Get name of person who booked
LEFT JOIN card_db ON combined.booked_by = card_db.cardno -- Filter by card number

WHERE combined.booked_for = :cardno
  OR combined.booked_by = :cardno;`,
    {
      replacements: {
        cardno: req.user.cardno
      },
      type: database.QueryTypes.SELECT
    }
  );

  return res
    .status(200)
    .json({ message: 'transactions fetched', data: transactions });
};
