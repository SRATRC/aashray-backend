import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand
} from '@aws-sdk/client-s3';
import { CardDb, FlatDb } from '../../models/associations.js';
import { sendPushNotifications } from '../../helpers/notification.helper.js';
import { attachUserContext } from '../../middleware/Logger.js';
import database from '../../config/database.js';
import ApiError from '../../utils/ApiError.js';
import multer from 'multer';
import path from 'path';
import { sendWhatsAppMessage } from '../../utils/sendWhatsAppMessage.js';
import { formatWhatsAppPhone } from '../../utils/phoneFormatter.js';
import moment from 'moment-timezone';
import fs from 'fs';

export const updateProfile = async (req, res) => {
  attachUserContext(req);
  req.log.info('update_profile_start', { cardno: req.user.cardno });

  const {
    issuedto,
    gender,
    dob,
    address,
    mobno,
    idType,
    idNo,
    email,
    country,
    state,
    city,
    pin,
    center
  } = req.body;

  const card = await CardDb.findOne({ where: { cardno: req.user.cardno } });
  if (!card) {
    throw new ApiError(404, 'User not found');
  }

  // --- Compare to find changed fields ---
  const isChanged = (newVal, oldVal) => {
    if (newVal === undefined) return false;
    const normalize = (v) =>
      v === null || v === undefined ? '' : String(v).trim();
    return normalize(newVal) !== normalize(oldVal);
  };

  const changed = [];
  if (isChanged(issuedto, card.issuedto)) changed.push('Name');
  if (isChanged(gender, card.gender)) changed.push('Gender');
  if (isChanged(dob, card.dob)) changed.push('Date of Birth');
  if (isChanged(mobno, card.mobno)) changed.push('Mobile Number');
  if (isChanged(idType, card.idType)) changed.push('ID Type');
  if (isChanged(idNo, card.idNo)) changed.push('ID Number');
  if (isChanged(email, card.email)) changed.push('Email');
  if (isChanged(address, card.address)) changed.push('Address');
  if (isChanged(country, card.country)) changed.push('Country');
  if (isChanged(state, card.state)) changed.push('State');
  if (isChanged(city, card.city)) changed.push('City');
  if (isChanged(pin, card.pin)) changed.push('Pin');
  if (isChanged(center, card.center)) changed.push('Center');

  const updatedProfile = await CardDb.update(
    {
      issuedto,
      gender,
      dob,
      address,
      mobno,
      idType,
      idNo,
      email,
      country,
      state,
      city,
      pin,
      center
    },
    {
      where: {
        cardno: req.user.cardno
      }
    }
  );

  if (!updatedProfile) {
    req.log.error('update_profile_failed', { cardno: req.user.cardno });
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

  req.log.info('update_profile_success', { cardno: req.user.cardno });

  // --- Send WhatsApp notification if any details were changed ---
  if (changed.length > 0) {
    const targetPhone = mobno || card.mobno;
    if (targetPhone) {
      try {
        const formattedPhone = formatWhatsAppPhone(
          targetPhone,
          country || card.country
        );

        const formattedTime = moment()
          .tz('Asia/Kolkata')
          .format('DD-MM-YYYY hh:mm A');

        const components = [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: issuedto || card.issuedto || 'Mumukshu' },
              { type: 'text', text: card.cardno },
              { type: 'text', text: formattedTime },
              { type: 'text', text: changed.join(', ') },
              { type: 'text', text: issuedto || card.issuedto || 'Mumukshu' }
            ]
          }
        ];

        await sendWhatsAppMessage(
          formattedPhone,
          'profile_updated',
          components
        );
      } catch (waErr) {
        console.error(
          'Error sending WhatsApp profile_updated message in updateProfile:',
          waErr.message || waErr
        );
      }
    }
  }

  return res
    .status(200)
    .send({ message: 'Profile Updated', data: updatedProfileData });
};

export const upload = async (req, res) => {
  attachUserContext(req);
  req.log.info('upload_profile_pic_start', {
    cardno: req.user.cardno,
    hasPfp: !!req.user.pfp
  });
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
      req.log.warn('upload_profile_pic_multer_error', {
        cardno: req.user.cardno,
        error: err.message
      });
      return res.status(400).json({ error: `Multer error: ${err.message}` });
    } else if (err) {
      req.log.warn('upload_profile_pic_error', {
        cardno: req.user.cardno,
        error: err.message
      });
      return res.status(400).json({ error: err.message });
    }

    if (!req.file) {
      req.log.warn('upload_profile_pic_no_file', { cardno: req.user.cardno });
      return res.status(400).json({ error: 'Please upload an image file' });
    }

    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const fileName = `${uniqueSuffix}${path.extname(req.file.originalname)}`;
    let fileUrl = '';

    const isS3Configured =
      process.env.AWS_S3_BUCKET_NAME &&
      process.env.AWS_ACCESS_KEY_ID &&
      process.env.AWS_SECRET_ACCESS_KEY;

    if (isS3Configured) {
      const uploadParams = {
        Bucket: process.env.AWS_S3_BUCKET_NAME,
        Key: fileName,
        Body: req.file.buffer,
        ContentType: req.file.mimetype
      };

      await s3.send(new PutObjectCommand(uploadParams));
      fileUrl = `https://${process.env.AWS_S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileName}`;
      req.log.info('upload_profile_pic_s3_uploaded', {
        cardno: req.user.cardno,
        fileName
      });
    } else {
      // Local fallback for development/local testing
      const uploadPath = path.join(process.cwd(), 'public/uploads', fileName);
      await fs.promises.writeFile(uploadPath, req.file.buffer);
      // Build static serving URL
      fileUrl = `${req.protocol}://${req.get('host')}/uploads/${fileName}`;
      req.log.info('upload_profile_pic_local_saved', {
        cardno: req.user.cardno,
        fileName,
        fileUrl
      });
    }

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
      if (isS3Configured) {
        const deleteParams = {
          Bucket: process.env.AWS_S3_BUCKET_NAME,
          Key: oldKey
        };

        try {
          await s3.send(new DeleteObjectCommand(deleteParams));
          req.log.info('upload_profile_pic_old_deleted', {
            cardno: req.user.cardno,
            oldKey
          });
        } catch (delErr) {
          req.log.error('upload_profile_pic_old_delete_failed', {
            cardno: req.user.cardno,
            oldKey,
            error: delErr.message
          });
        }
      } else {
        // Delete local file
        const oldPath = path.join(process.cwd(), 'public/uploads', oldKey);
        try {
          if (fs.existsSync(oldPath)) {
            await fs.promises.unlink(oldPath);
            req.log.info('upload_profile_pic_old_local_deleted', {
              cardno: req.user.cardno,
              oldKey
            });
          }
        } catch (delErr) {
          req.log.error('upload_profile_pic_old_local_delete_failed', {
            cardno: req.user.cardno,
            oldKey,
            error: delErr.message
          });
        }
      }
    }

    req.log.info('upload_profile_pic_success', {
      cardno: req.user.cardno,
      fileUrl
    });
    return res.status(200).json({
      message: 'File uploaded successfully',
      data: fileUrl
    });
  });
};

export const transactions = async (req, res) => {
  attachUserContext(req);
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.page_size) || 10;
  const offset = (page - 1) * pageSize;
  req.log.info('fetch_transactions_start', {
    cardno: req.user.cardno,
    page,
    pageSize,
    status: req.query.status,
    category: req.query.category
  });

  let status = req.query.status || null;
  if (status) {
    if (typeof status === 'string' && status.includes(',')) {
      status = status.split(',').map((s) => s.trim());
    }
    if (!Array.isArray(status)) {
      status = [status];
    }

    status = status.filter((s) => s && s !== 'all');
    if (status.length === 0) {
      status = null;
    }
  }

  const category = req.query.category || null;
  const cardno = req.user.cardno;

  let whereClause = `WHERE transactions.cardno = :cardno`;

  if (status && status.length > 0) {
    if (status.length === 1) {
      whereClause += ` AND transactions.status = :status`;
    } else {
      whereClause += ` AND transactions.status IN (:status)`;
    }
  }

  if (category && category !== 'all') {
    whereClause += ` AND transactions.category = :category`;
  }

  const replacements = {
    cardno: cardno,
    limit: pageSize,
    offset: offset
  };

  if (status && status.length > 0) {
    replacements.status = status.length === 1 ? status[0] : status;
  }
  if (category) {
    replacements.category = category;
  }

  const query = `
    SELECT transactions.bookingid,
           transactions.amount,
           transactions.category,
           transactions.status,
           transactions.discount,
           transactions.description,
           transactions.createdAt,
           COALESCE(rb.cardno, fb.cardno, tb.cardno, sb.cardno, ub.cardno) AS booked_for,
           COALESCE(rb.bookedBy, fb.bookedBy, tb.bookedBy, sb.bookedBy, ub.bookedBy) AS booked_by,
           COALESCE(rb.checkin, fb.checkin, tb.date, sdb.start_date, updb.start_date) AS start_day,
           COALESCE(rb.checkout, fb.checkout, NULL, sdb.end_date, updb.end_date) AS end_day,
           COALESCE(sdb.name, udb.name) AS name,
           card_db.issuedto AS booked_for_name
    FROM transactions
    LEFT JOIN room_booking rb ON transactions.bookingid = rb.bookingid AND transactions.category = 'room'
    LEFT JOIN flat_booking fb ON transactions.bookingid = fb.bookingid AND transactions.category = 'flat'
    LEFT JOIN travel_db tb ON transactions.bookingid = tb.bookingid AND transactions.category = 'travel'
    LEFT JOIN shibir_booking_db sb ON transactions.bookingid = sb.bookingid AND transactions.category = 'adhyayan'
    LEFT JOIN shibir_db sdb ON sb.shibir_id = sdb.id
    LEFT JOIN utsav_booking ub ON transactions.bookingid = ub.bookingid AND transactions.category = 'utsav'
    LEFT JOIN utsav_packages_db updb ON ub.packageid = updb.id
    LEFT JOIN utsav_db udb ON ub.utsavid = udb.id
    LEFT JOIN card_db ON COALESCE(rb.cardno, fb.cardno, tb.cardno, sb.cardno, ub.cardno) = card_db.cardno
    ${whereClause}
    ORDER BY transactions.createdAt DESC
    LIMIT :limit OFFSET :offset
  `;

  const transactions = await database.query(query, {
    replacements,
    type: database.QueryTypes.SELECT
  });

  req.log.info('fetch_transactions_success', {
    cardno: req.user.cardno,
    count: transactions.length,
    hasMore: transactions.length === pageSize
  });
  return res.status(200).json({
    message: 'transactions fetched',
    data: transactions,
    pagination: {
      page,
      pageSize,
      hasMore: transactions.length === pageSize
    }
  });
};

export const sendNotification = async (req, res) => {
  attachUserContext(req);
  const { tokenData } = req.body;
  req.log.info('send_notification_start', {
    cardno: req.user.cardno,
    tokenCount: tokenData?.length
  });

  if (!tokenData || !Array.isArray(tokenData) || tokenData.length === 0) {
    req.log.warn('send_notification_invalid_data', { cardno: req.user.cardno });
    throw new ApiError(
      400,
      'Invalid request: tokenData must be a non-empty array'
    );
  }

  const result = await sendPushNotifications(tokenData);
  req.log.info('send_notification_success', {
    cardno: req.user.cardno,
    sentCount: result.sentCount,
    totalRequested: result.totalRequested
  });

  return res.status(200).json({
    message: 'Notifications sent successfully',
    tickets: result.tickets,
    sentCount: result.sentCount,
    totalRequested: result.totalRequested
  });
};

export const fetchProfile = async (req, res) => {
  attachUserContext(req);
  const { cardno } = req.user;
  req.log.info('fetch_profile_start', { cardno });

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
    req.log.warn('fetch_profile_not_found', { cardno });
    throw new ApiError(404, 'user not found');
  }

  const isFlatOwner = await FlatDb.findOne({
    attributes: ['flatno'],
    where: {
      owner: cardno
    }
  });

  profile.setDataValue('isFlatOwner', !!isFlatOwner);

  req.log.info('fetch_profile_success', { cardno, isFlatOwner: !!isFlatOwner });
  return res.status(200).json({ message: 'Profile fetched', data: profile });
};
