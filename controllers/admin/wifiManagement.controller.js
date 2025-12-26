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
  STATUS_REJECTED,
  STATUS_DELETED
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

import { Op } from 'sequelize';

export const getPermanentCodeRequests = async (req, res) => {
  try {
    const { status, requestType } = req.query;

    const whereClause = {};

    const allowedStatuses = [
      'pending',
      'approved',
      'deleted',
      'reset',
      'rejected'
    ];

    // Normal status filter
    if (status && allowedStatuses.includes(status)) {
      whereClause.status = status;
    }

    // Admin-only differentiation
    if (requestType === 'pending-new') {
      whereClause.status = 'pending';
      whereClause.code = null;
    }

    if (requestType === 'pending-reset') {
      whereClause.status = 'pending';
      whereClause.code = { [Op.not]: null };
    }

    const rows = await PermanentWifiCodes.findAll({
      where: whereClause,
      include: [
        {
          model: CardDb,
          attributes: ['cardno', 'issuedto', 'email', 'mobno', 'res_status']
        }
      ],
      order: [['requested_at', 'DESC']]
    });

    res.status(200).json({
      message: 'Permanent WiFi code requests fetched successfully',
      data: {
        requests: rows,
        total: rows.length
      }
    });
  } catch (error) {
    console.error('Error fetching permanent WiFi code requests:', error);
    res.status(500).json({
      message: error.message
    });
  }
};

export const updatePermanentCodeRequest = async (req, res) => {
  const t = await database.transaction();
  req.transaction = t;

  try {
    const { requestId } = req.params;
    const { action, permanent_code, admin_comments, ssid, username } = req.body;

    if (!action || ![STATUS_APPROVED, STATUS_REJECTED, STATUS_DELETED].includes(action)) {
  throw new ApiError(
    400,
    'Invalid action. Must be "approved", "rejected" or "deleted"'
  );
}

    // 🔹 FIRST: fetch record
    const checkAlreadyrequested = await PermanentWifiCodes.findByPk(requestId, {
      transaction: t,
      lock: t.LOCK.UPDATE
    });

    if (!checkAlreadyrequested) {
      throw new ApiError(404, 'Permanent code request not found');
    }
    if (action === STATUS_DELETED && checkAlreadyrequested.status !== STATUS_APPROVED) {
      throw new ApiError(400, 'Only approved requests can be deleted');
    }
    // Prevent re-approving or re-rejecting an already approved request
if (
  checkAlreadyrequested.status === STATUS_APPROVED &&
  action !== STATUS_DELETED
) {
  throw new ApiError(400, `Request has already been approved`);
}

    // 🔹 SECOND: validation based on existing DB state
    if (
      action === STATUS_APPROVED &&
      checkAlreadyrequested.code == null && // pending-new
      !permanent_code
    ) {
      throw new ApiError(400, 'Permanent code is required for approval');
    }

    // 🔹 THIRD: duplicate code check (only for new)
    if (action === STATUS_APPROVED && permanent_code) {
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

    // 🔹 FOURTH: prepare update payload
    const updateData = {
      status: action,
      reviewed_at: new Date(),
      reviewed_by: req.user?.username,
      admin_comments
    };

    // Assign code ONLY for pending-new approval
    if (action === STATUS_APPROVED && checkAlreadyrequested.code == null) {
      updateData.code = permanent_code;
    }

    if (typeof ssid !== 'undefined') {
      updateData.ssid = ssid === null ? null : ssid;
    }

    if (typeof username !== 'undefined') {
      updateData.username = username === null ? null : username;
    }

    await checkAlreadyrequested.update(updateData, { transaction: t });

    await t.commit();

    await checkAlreadyrequested.reload();

    res.status(200).json({
      message: `Permanent WiFi code request ${action} successfully`,
      data: checkAlreadyrequested
    });
  } catch (error) {
    try {
      await t.rollback();
    } catch (rbErr) {
      console.error('Rollback error:', rbErr);
    }

    console.error('Error updating permanent code request:', error);

    if (error instanceof ApiError) {
      return res
        .status(error.statusCode || 400)
        .json({ message: error.message, data: null });
    }

    res.status(500).json({
      message: error.message || 'Internal server error',
      data: null
    });
  }
};

function formatDateForMySQL(date) {
  const pad = (n) => n.toString().padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
      date.getDate()
    )} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(
      date.getSeconds()
    )}`
  );
}

export const uploadPerWiFiCodes = async (req, res) => {
  try {
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheet = XLSX.utils.sheet_to_json(
      workbook.Sheets[workbook.SheetNames[0]],
      { defval: '' }
    );

    // Keep rows that have cardno AND code (same behavior as before),
    // but also read optional ssid and username columns.
    const updates = sheet
      .map((row) => ({
        cardno: row.cardno?.toString().trim(),
        code: row.code?.toString().trim(),
        ssid: row.ssid?.toString().trim(),
        username: row.username?.toString().trim()
      }))
      .filter((row) => row.cardno && row.code); // require both cardno and code

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No valid rows found.' });
    }

    // helper to escape single quotes for SQL string literals
    const esc = (s) => (s === null || typeof s === 'undefined' ? '' : s.replace(/'/g, "\\'"));

    // Build CASE clauses for code, ssid and username
    const codeCases = updates
      .map((u) => `WHEN cardno = '${esc(u.cardno)}' THEN '${esc(u.code)}'`)
      .join(' ');
    const ssidCases = updates
      .filter((u) => u.ssid) // only include ssid when provided
      .map((u) => `WHEN cardno = '${esc(u.cardno)}' THEN '${esc(u.ssid)}'`)
      .join(' ');
    const usernameCases = updates
      .filter((u) => u.username) // only include username when provided
      .map((u) => `WHEN cardno = '${esc(u.cardno)}' THEN '${esc(u.username)}'`)
      .join(' ');

    const cardnos = updates.map((u) => `'${esc(u.cardno)}'`).join(', ');

    const now = formatDateForMySQL(new Date());

    // Build SET parts conditionally
    const setParts = [];

    // code CASE is required (since we filtered for rows having code)
    if (codeCases) {
      setParts.push(`code = CASE ${codeCases} END`);
      // if codes are being applied we want to mark approved (same as before)
      setParts.push(`status = 'approved'`);
      setParts.push(`reviewed_at = '${now}'`);
      setParts.push(`reviewed_by = '${esc(req.user?.username || 'wifiAdmin')}'`);
    }

    // optional ssid
    if (ssidCases) {
      setParts.push(`ssid = CASE ${ssidCases} END`);
    }

    // optional username
    if (usernameCases) {
      setParts.push(`username = CASE ${usernameCases} END`);
    }

    // always update updatedAt
    setParts.push(`updatedAt = '${now}'`);

    const setClause = setParts.join(',\n          ');

    const query = `
      UPDATE permanent_wifi_codes
      SET ${setClause}
      WHERE cardno IN (${cardnos}) AND status = 'pending' AND code IS NULL
    `;

    await PermanentWifiCodes.sequelize.query(query);

    res.status(200).json({
      message: `${updates.length} record(s) processed.`
    });
  } catch (err) {
    console.error('Error processing Excel upload:', err);
    res.status(500).json({
      error: 'Failed to process and update Excel data: ' + err.message
    });
  }
};


export const addPermanentCodeManually = async (req, res) => {
  const t = await database.transaction();
  req.transaction = t;

  try {
    const {
      mobno,
      cardno,
      // issuedto,
      // res_status,
      ssid,
      deviceType,
      username,
      code
    } = req.body;

    if (!mobno || !cardno || !ssid || !code) {
      throw new ApiError(400, 'Required fields missing');
    }

    // verify card exists
    const card = await CardDb.findOne({
      where: { cardno, mobno },
      transaction: t
    });

    if (!card) {
      throw new ApiError(404, 'Card not found');
    }

    await PermanentWifiCodes.create(
      {
        cardno,
        username,
        ssid,
        deviceType,
        code,
        status: STATUS_APPROVED,
        reviewed_at: new Date(),
        // requested_by: req.user.cardno
      },
      { transaction: t }
    );

    await t.commit();

    return res.status(201).json({
      message: 'Permanent WiFi code added successfully'
    });

  } catch (err) {
    // ✅ IMPORTANT: rollback on ANY failure
    if (t) await t.rollback();
    throw err; // let global error handler respond
  }
};
