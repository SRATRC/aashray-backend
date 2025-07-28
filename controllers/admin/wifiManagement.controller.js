import XLSX from 'xlsx';
import {
  WifiDb,
  CardDb,
  PermanentWifiCodes
} from '../../models/associations.js';
import database from '../../config/database.js';
import Sequelize from 'sequelize';
import {
  STATUS_PENDING,
  STATUS_APPROVED,
  STATUS_REJECTED
} from '../../config/constants.js';
import ApiError from '../../utils/ApiError.js';

export const uploadWiFiCodes = async (req, res) => {
  try {
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheet = XLSX.utils.sheet_to_json(
      workbook.Sheets[workbook.SheetNames[0]],
      { defval: '' }
    );

    const formattedRows = [];

    for (const row of sheet) {
      const createdAt = new Date(); // automatically use current timestamp

      formattedRows.push({
        cardno: null,
        password: row.password,
        roombookingid: null,
        status: 'active',
        updatedBy: req.user?.username || 'wifiAdmin', // fallback
        created_at: createdAt // ✅ your DB expects this name
      });
    }

    if (formattedRows.length === 0) {
      return res
        .status(400)
        .json({ error: 'No valid rows found with correct date format.' });
    }

    const incomingPwd = formattedRows.map((row) => row.password);

    const existingRecords = await WifiDb.findAll({
      where: { password: incomingPwd },
      attributes: ['password'],
      raw: true
    });

    const existingPwd = new Set(existingRecords.map((r) => r.password));

    const uniqueRows = formattedRows.filter(
      (row) => !existingPwd.has(row.password)
    );

    if (uniqueRows.length === 0) {
      return res.status(200).json({
        message: 'No new rows to insert. All passwords were duplicates.'
      });
    }

    await WifiDb.bulkCreate(uniqueRows);

    res.status(200).json({
      message: `${uniqueRows.length} new record(s) inserted. ${
        formattedRows.length - uniqueRows.length
      } duplicate(s) ignored.`
    });
  } catch (err) {
    console.error('Error processing Excel upload:', err);
    res.status(500).json({
      error: 'Failed to process and store Excel data: ' + err.message
    });
  }
};

export const wifiRecord = async (req, res) => {
  const { startDate, endDate, status, bookingType } = req.query;

  let whereClause = 'WHERE 1 = 1';
  const replacements = {};

  if (startDate && endDate) {
    whereClause += ' AND DATE(wp.updatedAt) BETWEEN :startDate AND :endDate';
    replacements.startDate = startDate;
    replacements.endDate = endDate;
  }

  if (status && status !== 'all') {
    whereClause += ' AND wp.status = :status';
    replacements.status = status;
  }

  if (bookingType === 'room') {
    whereClause += ' AND rb.bookingid IS NOT NULL';
  } else if (bookingType === 'flat') {
    whereClause += ' AND fb.bookingid IS NOT NULL';
  }

  const query = `
    SELECT 
      wp.cardno,
      wp.password,
      wp.roombookingid,
      wp.status,
      wp.updatedAt AS wifi_updatedAt,

      cd.issuedto,
      cd.mobno,
      cd.email,

      rb.checkin AS room_checkin,
      rb.checkout AS room_checkout,
      rb.updatedAt AS room_updatedAt,

      fb.checkin AS flat_checkin,
      fb.checkout AS flat_checkout,
      fb.updatedAt AS flat_updatedAt

    FROM wifi_pwd AS wp

    LEFT JOIN card_db AS cd ON wp.cardno = cd.cardno
    LEFT JOIN room_booking AS rb ON wp.roombookingid = rb.bookingid
    LEFT JOIN flat_booking AS fb ON wp.roombookingid = fb.bookingid

    ${whereClause}
    ORDER BY wp.updatedAt DESC;
  `;

  try {
    const result = await database.query(query, {
      type: Sequelize.QueryTypes.SELECT,
      replacements
    });

    res.status(200).json({ message: 'Success', data: result });
  } catch (err) {
    console.error('Error fetching wifi records:', err);
    res.status(500).json({ error: 'Failed to fetch wifi records' });
  }
};

export const getPermanentCodeRequests = async (req, res) => {
  const { status, page = 1, limit = 10 } = req.query;
  const offset = (page - 1) * limit;

  const whereClause = {};
  if (
    status &&
    [STATUS_PENDING, STATUS_APPROVED, STATUS_REJECTED].includes(status)
  ) {
    whereClause.request_status = status;
  }

  const { count, rows } = await PermanentWifiCodes.findAndCountAll({
    where: whereClause,
    include: [
      {
        model: CardDb,
        attributes: ['cardno', 'issuedto', 'email', 'mobno', 'res_status']
      }
    ],
    order: [['requested_at', 'DESC']],
    limit: parseInt(limit),
    offset: parseInt(offset)
  });

  res.status(200).json({
    message: 'Permanent WiFi code requests fetched successfully',
    data: {
      requests: rows,
      pagination: {
        total: count,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(count / limit)
      }
    }
  });
};

export const updatePermanentCodeRequest = async (req, res) => {
  const t = await database.transaction();
  req.transaction = t;

  const { requestId } = req.params;
  const { action, permanent_code, admin_comments } = req.body;

  if (!action || ![STATUS_APPROVED, STATUS_REJECTED].includes(action)) {
    throw new ApiError(
      400,
      'Invalid action. Must be either "approve" or "reject"'
    );
  }

  if (action === STATUS_APPROVED && !permanent_code) {
    throw new ApiError(400, 'Permanent code is required for approval');
  }

  const checkAlreadyrequested = await PermanentWifiCodes.findByPk(requestId, {
    transaction: t
  });

  if (!checkAlreadyrequested) {
    throw new ApiError(404, 'Permanent code request not found');
  }

  if (checkAlreadyrequested.status == STATUS_APPROVED) {
    throw new ApiError(
      400,
      `Request has already been ${checkAlreadyrequested.status}`
    );
  }

  if (action === STATUS_APPROVED) {
    const existingCode = await PermanentWifiCodes.findOne({
      where: {
        code: permanent_code,
        status: STATUS_APPROVED
      },
      transaction: t
    });

    if (existingCode) {
      throw new ApiError(
        400,
        `This permanent code is already assigned to another user: ${existingCode.cardno}`
      );
    }
  }

  const updateData = {
    status: action,
    reviewed_at: new Date(),
    reviewed_by: req.user?.username,
    admin_comments
  };

  if (action === STATUS_APPROVED) {
    updateData.code = permanent_code;
  }

  await checkAlreadyrequested.update(updateData, { transaction: t });
  await t.commit();

  res.status(200).json({
    message: `Permanent WiFi code request ${action} successfully`,
    data: checkAlreadyrequested
  });
};
