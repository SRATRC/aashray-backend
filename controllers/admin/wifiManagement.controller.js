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
  STATUS_DELETED,
  STATUS_RESET
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
      whereClause.status = 'reset';
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

if (
  !action ||
  ![
    STATUS_APPROVED,
    STATUS_REJECTED,
    STATUS_DELETED,
    STATUS_RESET,
    STATUS_PENDING
  ].includes(action)
) {
  throw new ApiError(
    400,
    'Invalid action. Must be approved, rejected, deleted, reset or pending'
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
    if (
  checkAlreadyrequested.status === STATUS_DELETED &&
  action === STATUS_DELETED
) {
  throw new ApiError(400, 'Request is already deleted');
}
if (
  action === STATUS_RESET &&
  checkAlreadyrequested.status !== STATUS_APPROVED
) {
  throw new ApiError(
    400,
    'Only approved requests can be moved to reset'
  );
}


    // Prevent re-approving or re-rejecting an already approved request
// Allow admin to change status freely
// Backend remains authoritative for validations

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

// Assign code only when approving a record without one
if (action === STATUS_APPROVED && checkAlreadyrequested.code == null) {
  updateData.code = permanent_code;
}

// Optional: clear code when going to reset
if (action === STATUS_RESET) {
  updateData.code = null;
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
  const transaction = await PermanentWifiCodes.sequelize.transaction();

  try {
    /* =====================================================
       1. READ EXCEL
       ===================================================== */
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheet = XLSX.utils.sheet_to_json(
      workbook.Sheets[workbook.SheetNames[0]],
      { defval: '' }
    );

    if (!sheet.length) {
      return res.status(400).json({ error: 'Excel file is empty' });
    }

    /* =====================================================
       2. NORMALIZE & VALIDATE EXCEL ROWS
       ===================================================== */
    const allowedStatuses = new Set(['approved', 'deleted', 'rejected', 'reset']);

    const parsed = sheet.map((row, index) => {
      const rawId = row.id?.toString().trim();
      const cardno = row.cardno?.toString().trim();
      const code = row.code?.toString().trim();
      const excelStatus = row.status?.toString().trim().toLowerCase();

      return {
        rowNumber: index + 2,
        rawId,
        id: /^\d+$/.test(rawId) ? parseInt(rawId, 10) : null,
        cardno,
        code,
        ssid: row.ssid?.toString().trim() || null,
        username: row.username?.toString().trim() || null,
        status: allowedStatuses.has(excelStatus) ? excelStatus : null
      };
    });

    const invalidRows = parsed.filter(
      r => !r.id || !r.cardno || !r.code
    );

    const validRows = parsed.filter(
      r => r.id && r.cardno && r.code
    );

    if (!validRows.length) {
      return res.status(400).json({
        error: 'No valid rows found',
        invalidRows
      });
    }

    /* =====================================================
       3. VERIFY id + cardno EXISTS IN DB
       ===================================================== */
    const dbRows = await PermanentWifiCodes.findAll({
      where: {
        id: validRows.map(r => r.id)
      },
      attributes: ['id', 'cardno', 'status'],
      transaction
    });

    const dbMap = new Map(
      dbRows.map(r => [`${r.id}|${r.cardno}`, r.status])
    );

    const matched = [];
    const mismatched = [];

    for (const r of validRows) {
      if (dbMap.has(`${r.id}|${r.cardno}`)) {
        matched.push(r);
      } else {
        mismatched.push(r);
      }
    }

    /* =====================================================
       4. DRY RUN MODE
       ===================================================== */
    if (req.query.dryRun === 'true') {
      await transaction.rollback();
      return res.json({
        dryRun: true,
        summary: {
          totalRows: sheet.length,
          validRows: validRows.length,
          matched: matched.length,
          mismatched: mismatched.length,
          invalidRows: invalidRows.length
        },
        matched,
        mismatched,
        invalidRows
      });
    }

    if (!matched.length) {
      await transaction.rollback();
      return res.status(400).json({
        error: 'No matching id + cardno pairs found in DB',
        mismatched
      });
    }

    /* =====================================================
       5. BUILD SAFE CASE STATEMENTS
       ===================================================== */
    const esc = v => v.replace(/'/g, "\\'");
    const now = formatDateForMySQL(new Date());
    const reviewer = esc(req.user?.username || 'admin');

    const codeCases = matched
      .map(r =>
        `WHEN id = ${r.id} AND cardno = '${esc(r.cardno)}' THEN '${esc(r.code)}'`
      )
      .join(' ');

    const ssidCases = matched
      .filter(r => r.ssid)
      .map(r =>
        `WHEN id = ${r.id} AND cardno = '${esc(r.cardno)}' THEN '${esc(r.ssid)}'`
      )
      .join(' ');

    const usernameCases = matched
      .filter(r => r.username)
      .map(r =>
        `WHEN id = ${r.id} AND cardno = '${esc(r.cardno)}' THEN '${esc(r.username)}'`
      )
      .join(' ');

    const statusCases = matched
      .filter(r => r.status)
      .map(r =>
        `WHEN id = ${r.id} AND cardno = '${esc(r.cardno)}' THEN '${esc(r.status)}'`
      )
      .join(' ');

    const whereClause = matched
      .map(r => `(id = ${r.id} AND cardno = '${esc(r.cardno)}')`)
      .join(' OR ');

    const query = `
      UPDATE permanent_wifi_codes
      SET
        code = CASE
          ${codeCases}
          ELSE code
        END,

        ssid = CASE
          ${ssidCases || 'WHEN 1=0 THEN ssid'}
          ELSE ssid
        END,

        username = CASE
          ${usernameCases || 'WHEN 1=0 THEN username'}
          ELSE username
        END,

        status = CASE
          ${statusCases || 'WHEN 1=0 THEN status'}
          ELSE status
        END,

        reviewed_by = '${reviewer}',
        reviewed_at = '${now}',
        updatedAt = '${now}'
      WHERE ${whereClause};
    `;

    /* =====================================================
       6. EXECUTE UPDATE
       ===================================================== */
    await PermanentWifiCodes.sequelize.query(query, { transaction });
    await transaction.commit();

    /* =====================================================
       7. RESPONSE
       ===================================================== */
    res.json({
      success: true,
      updatedCount: matched.length,
      skipped: {
        invalidRows: invalidRows.length,
        mismatched: mismatched.length
      },
      mismatched,
      invalidRows
    });

  } catch (err) {
    await transaction.rollback();
    console.error(err);
    res.status(500).json({ error: err.message });
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

export const insertPerWiFiCodesFromExcel = async (req, res) => {
  // 🔐 ROLE CHECK
  // 🔒 EXPLICIT CONFIRMATION REQUIRED
  if (req.query.allowInsert !== 'true') {
    return res.status(400).json({
      error: 'Insert not allowed. Confirm by sending allowInsert=true'
    });
  }

  const transaction = await PermanentWifiCodes.sequelize.transaction();

  try {
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheet = XLSX.utils.sheet_to_json(
      workbook.Sheets[workbook.SheetNames[0]],
      { defval: '' }
    );

    if (!sheet.length) {
      return res.status(400).json({ error: 'Excel file is empty' });
    }

    /* =====================================================
       1. PARSE & VALIDATE
       ===================================================== */
    const allowedStatuses = new Set(['approved', 'pending']);

    const parsed = sheet.map((row, index) => {
      const rawId = row.id?.toString().trim();
      const cardno = row.cardno?.toString().trim();

      return {
        rowNumber: index + 2,
        id: /^\d+$/.test(rawId) ? parseInt(rawId, 10) : null,
        cardno,
        code: row.code?.toString().trim() || null,
        ssid: row.ssid?.toString().trim() || null,
        username: row.username?.toString().trim() || null,
        status: allowedStatuses.has(
          row.status?.toString().trim().toLowerCase()
        )
          ? row.status.toLowerCase()
          : 'approved'
      };
    });

    const invalidRows = parsed.filter(r => !r.id || !r.cardno);

    const validRows = parsed.filter(r => r.id && r.cardno);

    if (!validRows.length) {
      return res.status(400).json({
        error: 'No valid rows to insert',
        invalidRows
      });
    }

    /* =====================================================
       2. CHECK EXISTING DB ROWS
       ===================================================== */
    const existing = await PermanentWifiCodes.findAll({
      where: {
        id: validRows.map(r => r.id)
      },
      attributes: ['id', 'cardno'],
      transaction
    });

    const existingSet = new Set(
      existing.map(r => `${r.id}|${r.cardno}`)
    );

    const toInsert = validRows.filter(
      r => !existingSet.has(`${r.id}|${r.cardno}`)
    );

    const skippedExisting = validRows.filter(
      r => existingSet.has(`${r.id}|${r.cardno}`)
    );

    /* =====================================================
       3. DRY RUN PREVIEW
       ===================================================== */
    if (req.query.dryRun === 'true') {
      await transaction.rollback();
      return res.json({
        dryRun: true,
        summary: {
          totalRows: sheet.length,
          validRows: validRows.length,
          toInsert: toInsert.length,
          skippedExisting: skippedExisting.length,
          invalidRows: invalidRows.length
        },
        toInsert,
        skippedExisting,
        invalidRows
      });
    }

    if (!toInsert.length) {
      await transaction.rollback();
      return res.status(400).json({
        error: 'No new rows to insert',
        skippedExisting
      });
    }

    /* =====================================================
       4. INSERT
       ===================================================== */
    const now = formatDateForMySQL(new Date());

    await PermanentWifiCodes.bulkCreate(
      toInsert.map(r => ({
        id: r.id,
        cardno: r.cardno,
        code: r.code,
        ssid: r.ssid,
        username: r.username,
        status: r.status,
        reviewed_by: req.user.username,
        reviewed_at: now
      })),
      { transaction }
    );

    await transaction.commit();

    /* =====================================================
       5. RESPONSE
       ===================================================== */
    res.json({
      success: true,
      insertedCount: toInsert.length,
      skippedExisting: skippedExisting.length,
      invalidRows: invalidRows.length
    });

  } catch (err) {
    await transaction.rollback();
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};
