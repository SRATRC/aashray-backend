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
  STATUS_RESET,
  STATUS_ACTIVE
} from '../../config/constants.js';
import ApiError from '../../utils/ApiError.js';
import { sendWifiRequestWhatsApp } from '../../helpers/whatsapp.helper.js';

export const uploadWiFiCodes = async (req, res) => {
  try {
    req.log.info('upload_wifi_codes_start');

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
        status: STATUS_ACTIVE,
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

    req.log.info('upload_wifi_codes_success', { inserted: uniqueRows.length, duplicates: formattedRows.length - uniqueRows.length });
    res.status(200).json({
      message: `${uniqueRows.length} new record(s) inserted. ${formattedRows.length - uniqueRows.length
        } duplicate(s) ignored.`
    });
  } catch (err) {
    req.log.error('upload_wifi_codes_error', { error: err.message });
    res.status(500).json({
      error: 'Failed to process and store Excel data: ' + err.message
    });
  }
};

export const wifiRecord = async (req, res) => {
  const { startDate, endDate, status, bookingType } = req.query;
  req.log.info('wifi_record_start', { startDate, endDate, status, bookingType });

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

    req.log.info('wifi_record_success', { count: result.length });
    res.status(200).json({ message: 'Success', data: result });
  } catch (err) {
    req.log.error('wifi_record_error', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch wifi records' });
  }
};

import { Op } from 'sequelize';

export const getPermanentCodeRequests = async (req, res) => {
  try {
    const { status, requestType } = req.query;
    req.log.info('get_permanent_code_requests_start', { status, requestType });

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

    // 🔥 Decide order dynamically
    let orderField = 'requested_at';

    if (requestType === 'pending-reset') {
      orderField = 'updatedAt';
    }

    const rows = await PermanentWifiCodes.findAll({
      where: whereClause,
      include: [
        {
          model: CardDb,
          attributes: ['cardno', 'issuedto', 'email', 'mobno', 'res_status']
        }
      ],
      order: [[orderField, 'DESC']]
    });

    req.log.info('get_permanent_code_requests_success', { count: rows.length });
    res.status(200).json({
      message: 'Permanent WiFi code requests fetched successfully',
      data: {
        requests: rows,
        total: rows.length
      }
    });

  } catch (error) {
    req.log.error('get_permanent_code_requests_error', { error: error.message });
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
    req.log.info('update_permanent_code_request_start', { requestId, action });

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
          status: STATUS_APPROVED,
          id: { [Sequelize.Op.ne]: requestId }
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

    // Send WhatsApp message asynchronously
    sendWifiRequestWhatsApp(
      checkAlreadyrequested.cardno,
      checkAlreadyrequested.username,
      action,
    );

    req.log.info('update_permanent_code_request_success', { requestId, action });
    res.status(200).json({
      message: `Permanent WiFi code request ${action} successfully`,
      data: checkAlreadyrequested
    });
  } catch (error) {
    try {
      await t.rollback();
    } catch (rbErr) {
      req.log.error('update_permanent_code_request_rollback_error', { error: rbErr.message });
    }

    req.log.error('update_permanent_code_request_error', { error: error.message });

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
    req.log.info('upload_per_wifi_codes_start');

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheet = XLSX.utils.sheet_to_json(
      workbook.Sheets[workbook.SheetNames[0]],
      { defval: '' }
    );

    if (!sheet.length) {
      await transaction.rollback();
      return res.status(400).json({ error: 'Excel file is empty' });
    }

    const allowedStatuses = new Set(['approved', 'deleted', 'rejected', 'reset', 'pending']);
    const errors = [];

    // 1. Parsing & Basic Validation
    const getExcelRowValue = (row, possibleKeys) => {
      const foundKey = Object.keys(row).find(k =>
        possibleKeys.includes(k.trim().toLowerCase().replace(/[^a-z0-9]/g, ''))
      );
      return foundKey ? row[foundKey] : undefined;
    };

    const parsed = sheet.map((row, index) => {
      const rawId = getExcelRowValue(row, ['id', 'sr'])?.toString().trim();
      const cardno = getExcelRowValue(row, ['cardno', 'cardnumber', 'card'])?.toString().trim();
      const code = getExcelRowValue(row, ['code', 'wificode', 'permanentcode'])?.toString().trim() || null;
      const rawStatus = getExcelRowValue(row, ['status'])?.toString().trim();
      const ssid = getExcelRowValue(row, ['ssid'])?.toString().trim() || null;
      const username = getExcelRowValue(row, ['username'])?.toString().trim() || null;
      const deviceType = getExcelRowValue(row, ['devicetype', 'device'])?.toString().trim() || 'other';

      // Skip completely empty rows
      if (!rawId && !cardno && !code && !rawStatus && !ssid && !username) {
        return null;
      }

      const status = rawStatus ? rawStatus.toLowerCase() : 'approved';

      return {
        rowNumber: index + 2,
        rawId,
        id: /^\d+$/.test(rawId) ? parseInt(rawId, 10) : null,
        cardno,
        code,
        ssid,
        username,
        status,
        deviceType
      };
    }).filter(Boolean);

    // Validate structure
    parsed.forEach(r => {
      if (!r.rawId || r.id === null) {
        errors.push({ row: r.rowNumber, error: `Invalid or missing ID: '${r.rawId || ''}'` });
      }
      if (!r.cardno) {
        errors.push({ row: r.rowNumber, error: 'Missing Card Number.' });
      }
      if (r.status && !allowedStatuses.has(r.status)) {
        errors.push({ row: r.rowNumber, error: `Invalid status: '${r.status}'. Must be one of approved, deleted, rejected, reset, pending.` });
      }
    });

    const validRows = parsed.filter(r => r.id !== null && r.cardno);

    if (validRows.length === 0) {
      await transaction.rollback();
      return res.status(400).json({
        error: 'No valid rows found to process.',
        errors
      });
    }

    // 2. Fetch CardDb records in batch to verify card existence
    const cardnos = [...new Set(validRows.map(r => r.cardno))];
    const dbCards = await CardDb.findAll({
      where: { cardno: cardnos },
      attributes: ['cardno', 'issuedto'],
      transaction
    });
    const existingCards = new Set(dbCards.map(c => c.cardno));
    const cardNamesMap = new Map(dbCards.map(c => [c.cardno, c.issuedto]));

    // 3. Fetch current database records for the requested IDs
    const dbRows = await PermanentWifiCodes.findAll({
      where: { id: validRows.map(r => r.id) },
      transaction
    });
    const dbMap = new Map(dbRows.map(r => [r.id, r]));

    // 4. Fetch all approved codes to check database uniqueness
    const codesToCheck = [...new Set(validRows.map(r => r.code).filter(Boolean))];
    const approvedCodesInDb = await PermanentWifiCodes.findAll({
      where: {
        code: codesToCheck,
        status: 'approved'
      },
      attributes: ['id', 'cardno', 'code'],
      transaction
    });

    // Check duplicate codes in Excel
    const excelCodesSeen = new Set();
    const excelCodeDuplicates = new Set();
    validRows.forEach(r => {
      if (r.code) {
        if (excelCodesSeen.has(r.code)) {
          excelCodeDuplicates.add(r.code);
        }
        excelCodesSeen.add(r.code);
      }
    });

    // 5. Run row-by-row validation
    const matched = [];
    const mismatched = [];

    for (const r of validRows) {
      let hasRowError = false;

      // Card existence
      if (!existingCards.has(r.cardno)) {
        errors.push({ row: r.rowNumber, error: `Card number '${r.cardno}' does not exist.` });
        hasRowError = true;
      }

      // Check ID + Cardno exists
      const dbRow = dbMap.get(r.id);
      if (!dbRow || dbRow.cardno !== r.cardno) {
        mismatched.push(r);
        errors.push({ row: r.rowNumber, error: `No record found matching ID '${r.id}' and Card Number '${r.cardno}'.` });
        hasRowError = true;
        continue;
      }

      // If status is approved, code is required
      if (r.status === 'approved' && !r.code) {
        errors.push({ row: r.rowNumber, error: `WiFi code is required for 'approved' status.` });
        hasRowError = true;
      }

      // Check code uniqueness in Excel
      if (r.code && excelCodeDuplicates.has(r.code)) {
        errors.push({ row: r.rowNumber, error: `Duplicate code '${r.code}' found multiple times in the Excel sheet.` });
        hasRowError = true;
      }

      // Check code uniqueness in Database (only if status is approved)
      if (r.status === 'approved' && r.code) {
        const conflictingDbCode = approvedCodesInDb.find(dbC => dbC.code === r.code && dbC.id !== r.id);
        if (conflictingDbCode) {
          errors.push({ row: r.rowNumber, error: `Code '${r.code}' is already assigned to another approved request (Card: ${conflictingDbCode.cardno}).` });
          hasRowError = true;
        }
      }

      if (!hasRowError) {
        matched.push({
          excelRow: r,
          dbRow
        });
      }
    }

    if (errors.length > 0) {
      await transaction.rollback();
      return res.status(400).json({
        error: 'Validation failed',
        errors,
        mismatched
      });
    }

    // 6. Handle Dry Run Mode
    if (req.query.dryRun === 'true') {
      await transaction.rollback();

      const dryRunDiff = [];
      for (const m of matched) {
        const { excelRow, dbRow } = m;
        const changes = {};

        let newUsername = excelRow.username;
        if (!newUsername && !dbRow.username) {
          const issuedto = cardNamesMap.get(excelRow.cardno) || 'user';
          newUsername = await internalGenerateUsername({
            cardno: excelRow.cardno,
            issuedto,
            deviceType: excelRow.deviceType
          });
        }

        if (excelRow.code !== dbRow.code) changes.code = { old: dbRow.code, new: excelRow.code };
        if (excelRow.ssid !== dbRow.ssid) changes.ssid = { old: dbRow.ssid, new: excelRow.ssid };
        if (newUsername && newUsername !== dbRow.username) changes.username = { old: dbRow.username, new: newUsername };
        if (excelRow.status !== dbRow.status) changes.status = { old: dbRow.status, new: excelRow.status };

        if (Object.keys(changes).length > 0) {
          dryRunDiff.push({
            rowNumber: excelRow.rowNumber,
            id: excelRow.id,
            cardno: excelRow.cardno,
            changes
          });
        }
      }

      return res.json({
        dryRun: true,
        summary: {
          totalRows: sheet.length,
          validRows: validRows.length,
          matched: matched.length,
          invalidRows: parsed.length - validRows.length,
          changesCount: dryRunDiff.length
        },
        changes: dryRunDiff
      });
    }

    // 7. Process updates and queue notifications
    const now = new Date();
    const reviewer = req.user?.username || 'admin';
    const notifList = [];

    for (const m of matched) {
      const { excelRow, dbRow } = m;

      const finalDeviceType = (excelRow.deviceType && excelRow.deviceType !== 'other') ? excelRow.deviceType : dbRow.deviceType;

      // Auto-generate username if blank (both Excel and DB username are empty)
      let finalUsername = excelRow.username || dbRow.username;
      if (!finalUsername) {
        const issuedto = cardNamesMap.get(excelRow.cardno) || 'user';
        finalUsername = await internalGenerateUsername({
          cardno: excelRow.cardno,
          issuedto,
          deviceType: finalDeviceType
        });
      }

      const oldStatus = dbRow.status;
      const oldCode = dbRow.code;

      await dbRow.update({
        code: excelRow.code,
        ssid: excelRow.ssid,
        username: finalUsername,
        deviceType: finalDeviceType,
        status: excelRow.status,
        reviewed_by: reviewer,
        reviewed_at: now
      }, { transaction });

      // Track if status changed or code was assigned to notify user
      if (excelRow.status !== oldStatus || excelRow.code !== oldCode) {
        notifList.push({
          cardno: excelRow.cardno,
          username: finalUsername,
          status: excelRow.status,
          code: excelRow.code,
          deviceType: finalDeviceType
        });
      }
    }

    await transaction.commit();

    // Trigger asynchronous background WhatsApp sends
    if (notifList.length > 0) {
      sendBulkWifiNotifications(notifList);
    }

    req.log.info('upload_per_wifi_codes_success', { updatedCount: matched.length });
    return res.json({
      success: true,
      updatedCount: matched.length,
      notificationsQueued: notifList.length
    });

  } catch (err) {
    await transaction.rollback();
    req.log.error('upload_per_wifi_codes_error', { error: err.message });
    return res.status(500).json({ error: err.message });
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

    req.log.info('add_permanent_code_manually_start', { cardno, mobno, ssid, deviceType });

    if (!mobno || !cardno || !ssid || !code) {
      throw new ApiError(400, 'Required fields missing');
    }

    // verify card exists
    const card = await CardDb.findOne({
      where: { cardno, mobno },
      transaction: t
    });

    if (!card) {
      req.log.warn('add_permanent_code_manually_card_not_found', { cardno, mobno });
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

    // Send WhatsApp message asynchronously
    sendWifiRequestWhatsApp(
      cardno,
      username,
      STATUS_APPROVED,
      null,
      deviceType
    );
    req.log.info('add_permanent_code_manually_success', { cardno, ssid });
    return res.status(201).json({
      message: 'Permanent WiFi code added successfully'
    });

  } catch (err) {
    // req.transaction is set, so CatchAsync handles rollback — just log and rethrow
    // (a manual t.rollback() here would double-rollback and mask the real error).
    req.log.error('add_permanent_code_manually_error', { error: err.message });
    throw err; // let global error handler respond
  }
};

export const insertPerWiFiCodesFromExcel = async (req, res) => {
  // ROLE CHECK / EXPLICIT CONFIRMATION REQUIRED
  if (req.query.allowInsert !== 'true') {
    return res.status(400).json({
      error: 'Insert not allowed. Confirm by sending allowInsert=true'
    });
  }

  const transaction = await PermanentWifiCodes.sequelize.transaction();

  try {
    req.log.info('insert_per_wifi_codes_from_excel_start');
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheet = XLSX.utils.sheet_to_json(
      workbook.Sheets[workbook.SheetNames[0]],
      { defval: '' }
    );

    if (!sheet.length) {
      await transaction.rollback();
      return res.status(400).json({ error: 'Excel file is empty' });
    }

    const allowedStatuses = new Set(['approved', 'pending']);
    const errors = [];

    /* =====================================================
       1. PARSE & BASIC VALIDATION
       ===================================================== */
    const getExcelRowValue = (row, possibleKeys) => {
      const foundKey = Object.keys(row).find(k =>
        possibleKeys.includes(k.trim().toLowerCase().replace(/[^a-z0-9]/g, ''))
      );
      return foundKey ? row[foundKey] : undefined;
    };

    const parsed = sheet.map((row, index) => {
      const rawId = getExcelRowValue(row, ['id', 'sr'])?.toString().trim();
      const cardno = getExcelRowValue(row, ['cardno', 'cardnumber', 'card'])?.toString().trim();
      const code = getExcelRowValue(row, ['code', 'wificode', 'permanentcode'])?.toString().trim() || null;
      const rawStatus = getExcelRowValue(row, ['status'])?.toString().trim();
      const ssid = getExcelRowValue(row, ['ssid'])?.toString().trim() || null;
      const username = getExcelRowValue(row, ['username'])?.toString().trim() || null;
      const deviceType = getExcelRowValue(row, ['devicetype', 'device'])?.toString().trim() || 'other';

      // Skip completely empty rows
      if (!rawId && !cardno && !code && !rawStatus && !ssid && !username) {
        return null;
      }

      const status = rawStatus ? rawStatus.toLowerCase() : 'approved';

      return {
        rowNumber: index + 2,
        rawId,
        id: /^\d+$/.test(rawId) ? parseInt(rawId, 10) : null,
        cardno,
        code,
        ssid,
        username,
        status,
        deviceType
      };
    }).filter(Boolean);

    parsed.forEach(r => {
      if (!r.rawId || r.id === null) {
        errors.push({ row: r.rowNumber, error: `Invalid or missing ID: '${r.rawId || ''}'` });
      }
      if (!r.cardno) {
        errors.push({ row: r.rowNumber, error: 'Missing Card Number.' });
      }
      if (r.status && !allowedStatuses.has(r.status)) {
        errors.push({ row: r.rowNumber, error: `Invalid status: '${r.status}'. Must be either approved or pending.` });
      }
    });

    const validRows = parsed.filter(r => r.id !== null && r.cardno);

    if (validRows.length === 0) {
      await transaction.rollback();
      return res.status(400).json({
        error: 'No valid rows to insert',
        errors
      });
    }

    /* =====================================================
       2. BATCH FETCH DB RECORDS FOR CARD EXISTENCE & DUPLICATES
       ===================================================== */
    const cardnos = [...new Set(validRows.map(r => r.cardno))];
    const dbCards = await CardDb.findAll({
      where: { cardno: cardnos },
      attributes: ['cardno', 'issuedto'],
      transaction
    });
    const existingCards = new Set(dbCards.map(c => c.cardno));
    const cardNamesMap = new Map(dbCards.map(c => [c.cardno, c.issuedto]));

    // Check if ID + cardno combination already exists in DB
    const existingPermanentCodes = await PermanentWifiCodes.findAll({
      where: { id: validRows.map(r => r.id) },
      attributes: ['id', 'cardno'],
      transaction
    });
    const existingSet = new Set(existingPermanentCodes.map(r => `${r.id}|${r.cardno}`));

    // Fetch approved codes to check database uniqueness
    const codesToCheck = [...new Set(validRows.map(r => r.code).filter(Boolean))];
    const approvedCodesInDb = await PermanentWifiCodes.findAll({
      where: {
        code: codesToCheck,
        status: 'approved'
      },
      attributes: ['id', 'cardno', 'code'],
      transaction
    });

    // Check duplicate codes in Excel
    const excelCodesSeen = new Set();
    const excelCodeDuplicates = new Set();
    validRows.forEach(r => {
      if (r.code) {
        if (excelCodesSeen.has(r.code)) {
          excelCodeDuplicates.add(r.code);
        }
        excelCodesSeen.add(r.code);
      }
    });

    /* =====================================================
       3. DETAILED VALIDATIONS
       ==================================================== */
    const toInsert = [];
    const skippedExisting = [];

    for (const r of validRows) {
      let hasRowError = false;

      // Card check
      if (!existingCards.has(r.cardno)) {
        errors.push({ row: r.rowNumber, error: `Card number '${r.cardno}' does not exist.` });
        hasRowError = true;
      }

      // Check if already exists (ID check)
      if (existingSet.has(`${r.id}|${r.cardno}`)) {
        skippedExisting.push(r);
        continue;
      }

      // Approved status constraints
      if (r.status === 'approved' && !r.code) {
        errors.push({ row: r.rowNumber, error: `WiFi code is required for 'approved' status.` });
        hasRowError = true;
      }

      // Check Excel duplicate code
      if (r.code && excelCodeDuplicates.has(r.code)) {
        errors.push({ row: r.rowNumber, error: `Duplicate code '${r.code}' found multiple times in the Excel sheet.` });
        hasRowError = true;
      }

      // Check DB duplicate code
      if (r.status === 'approved' && r.code) {
        const conflictingDbCode = approvedCodesInDb.find(dbC => dbC.code === r.code);
        if (conflictingDbCode) {
          errors.push({ row: r.rowNumber, error: `Code '${r.code}' is already assigned to another approved request (Card: ${conflictingDbCode.cardno}).` });
          hasRowError = true;
        }
      }

      if (!hasRowError) {
        toInsert.push(r);
      }
    }

    if (errors.length > 0) {
      await transaction.rollback();
      return res.status(400).json({
        error: 'Validation failed',
        errors,
        skippedExisting
      });
    }

    /* =====================================================
       4. DRY RUN PREVIEW
       ===================================================== */
    if (req.query.dryRun === 'true') {
      await transaction.rollback();

      const previewRows = [];
      for (const r of toInsert) {
        let genUsername = r.username;
        if (!genUsername) {
          const issuedto = cardNamesMap.get(r.cardno) || 'user';
          genUsername = await internalGenerateUsername({
            cardno: r.cardno,
            issuedto,
            deviceType: r.deviceType
          });
        }
        previewRows.push({
          rowNumber: r.rowNumber,
          id: r.id,
          cardno: r.cardno,
          username: genUsername,
          code: r.code,
          ssid: r.ssid,
          status: r.status,
          deviceType: r.deviceType
        });
      }

      return res.json({
        dryRun: true,
        summary: {
          totalRows: sheet.length,
          validRows: validRows.length,
          toInsert: toInsert.length,
          skippedExisting: skippedExisting.length,
          invalidRows: parsed.length - validRows.length
        },
        toInsert: previewRows,
        skippedExisting,
        invalidRows: parsed.filter(r => !r.rawId || r.id === null || !r.cardno)
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
       5. INSERT
       ===================================================== */
    const now = new Date();
    const reviewer = req.user?.username || 'admin';
    const bulkInsertRows = [];
    const notifList = [];

    for (const r of toInsert) {
      let finalUsername = r.username;
      if (!finalUsername) {
        const issuedto = cardNamesMap.get(r.cardno) || 'user';
        finalUsername = await internalGenerateUsername({
          cardno: r.cardno,
          issuedto,
          deviceType: r.deviceType
        });
      }

      bulkInsertRows.push({
        id: r.id,
        cardno: r.cardno,
        code: r.code,
        ssid: r.ssid,
        username: finalUsername,
        status: r.status,
        reviewed_by: reviewer,
        reviewed_at: now,
        requested_at: now
      });

      notifList.push({
        cardno: r.cardno,
        username: finalUsername,
        status: r.status,
        code: r.code,
        deviceType: r.deviceType
      });
    }

    await PermanentWifiCodes.bulkCreate(bulkInsertRows, { transaction });
    await transaction.commit();

    // Trigger WhatsApp notifications in background
    if (notifList.length > 0) {
      sendBulkWifiNotifications(notifList);
    }

    req.log.info('insert_per_wifi_codes_from_excel_success', {
      insertedCount: toInsert.length,
      skippedExisting: skippedExisting.length
    });

    return res.json({
      success: true,
      insertedCount: toInsert.length,
      skippedExisting: skippedExisting.length,
      notificationsQueued: notifList.length
    });

  } catch (err) {
    await transaction.rollback();
    req.log.error('insert_per_wifi_codes_from_excel_error', { error: err.message });
    return res.status(500).json({ error: err.message });
  }
};

export const generateUsername = async (req, res) => {
  try {
    const { cardno, issuedto, deviceType } = req.query;

    if (!cardno || !issuedto || !deviceType) {
      return res.status(400).json({
        message: 'cardno, issuedto and deviceType are required'
      });
    }

    const username = await internalGenerateUsername({ cardno, issuedto, deviceType });

    return res.status(200).json({
      data: {
        username
      }
    });

  } catch (error) {
    console.error('Error generating username:', error);
    return res.status(500).json({
      message: error.message
    });
  }
};

/* =====================================================
   HELPER & TEMPLATE FUNCTIONS
   ===================================================== */

export const internalGenerateUsername = async ({ cardno, issuedto, deviceType = 'other' }) => {
  const DEVICE_SUFFIX_MAP = {
    mobile: 'ph',
    laptop: 'pc',
    tablet: 'tb',
    other: 'ot'
  };

  const deviceSuffix =
    DEVICE_SUFFIX_MAP[deviceType.toLowerCase()] || 'ot';

  const IGNORE_FIRST_NAMES = [
    'rcof', 'rchk', 'cons', 'chak', 'divi', 'paon', 'guest'
  ];

  let nameParts = issuedto
    .trim()
    .toLowerCase()
    .replace(/^guest-/, '')
    .split(/\s+/);

  while (
    nameParts.length > 1 &&
    IGNORE_FIRST_NAMES.includes(nameParts[0])
  ) {
    nameParts.shift();
  }

  const firstName = nameParts[0] || '';
  const lastName =
    nameParts.length > 1
      ? nameParts[nameParts.length - 1]
      : '';

  const cardLast4 = cardno.slice(-4);

  const baseUsername =
    `${firstName}${lastName}${cardLast4}${deviceSuffix}`.toLowerCase();

  const similarUsernames = await PermanentWifiCodes.findAll({
    attributes: ['username'],
    where: {
      username: {
        [Op.like]: `${baseUsername}%`
      },
      status: ['approved', 'reset', 'pending']
    }
  });

  let maxCounter = 0;

  similarUsernames.forEach((user) => {
    const currentUsername = user.username;
    const suffix = currentUsername.substring(baseUsername.length);

    if (suffix === '') {
      maxCounter = Math.max(maxCounter, 1);
    } else if (/^\d+$/.test(suffix)) {
      maxCounter = Math.max(maxCounter, parseInt(suffix, 10));
    }
  });

  const finalUsername =
    maxCounter === 0
      ? baseUsername
      : `${baseUsername}${maxCounter + 1}`;

  return finalUsername.toLowerCase();
};

const sendBulkWifiNotifications = (notifications) => {
  setTimeout(async () => {
    for (const notif of notifications) {
      try {
        await new Promise((resolve) => setTimeout(resolve, 200)); // Throttling delay
        await sendWifiRequestWhatsApp(
          notif.cardno,
          notif.username,
          notif.status,
          notif.code,
          notif.deviceType
        );
      } catch (err) {
        console.error('Error sending background bulk WiFi WhatsApp notification:', err.message);
      }
    }
  }, 0);
};


export const exportPortalWifiCodes = async (req, res) => {
  try {
    req.log.info('export_portal_wifi_codes_start');

    const whereClause = { status: 'approved' };
    const { startDate, endDate, hours } = req.query;

    if (hours) {
      const cutoff = new Date(Date.now() - parseFloat(hours) * 60 * 60 * 1000);
      whereClause.reviewed_at = { [Op.gte]: cutoff };
    } else if (startDate && endDate) {
      whereClause.reviewed_at = {
        [Op.between]: [
          new Date(startDate + 'T00:00:00.000Z'),
          new Date(endDate + 'T23:59:59.999Z')
        ]
      };
    }

    // 1. Fetch approved permanent wifi codes matching filter including CardDb associations
    const approvedCodes = await PermanentWifiCodes.findAll({
      where: whereClause,
      include: [
        {
          model: CardDb,
          attributes: ['issuedto', 'res_status', 'email']
        }
      ]
    });

    const wb = XLSX.utils.book_new();

    // 2. Helper functions for derivation
    const deriveFirstName = (username, issuedto) => {
      if (!username) return '';

      // Clean username: remove ending digits and device suffix (e.g. 4768ph)
      let nameStr = username.replace(/[0-9]+[a-z]{2}$/i, '').trim().toLowerCase();
      if (nameStr === username.toLowerCase()) {
        nameStr = username.replace(/[0-9]+/g, '').slice(0, -2).toLowerCase();
      }

      // If we have card holder name, use it to accurately split the lowercase username string
      if (issuedto) {
        const IGNORE_FIRST_NAMES = [
          'rcof', 'rchk', 'cons', 'chak', 'divi', 'paon', 'guest'
        ];

        let nameParts = issuedto
          .trim()
          .toLowerCase()
          .replace(/^guest-/, '')
          .split(/\s+/);

        while (
          nameParts.length > 1 &&
          IGNORE_FIRST_NAMES.includes(nameParts[0])
        ) {
          nameParts.shift();
        }

        const firstName = nameParts[0] || '';
        if (firstName && nameStr.startsWith(firstName)) {
          const rest = nameStr.substring(firstName.length);
          const capFirst = firstName.charAt(0).toUpperCase() + firstName.slice(1);
          const capRest = rest ? rest.charAt(0).toUpperCase() + rest.slice(1) : '';
          return capRest ? `${capFirst}_${capRest}` : capFirst;
        }
      }

      // Fallback: capitalize whole cleaned name prefix
      return nameStr.charAt(0).toUpperCase() + nameStr.slice(1);
    };

    const deriveLastName = (username) => {
      if (!username) return 'Other';
      const suffix = username.slice(-2).toLowerCase();
      switch (suffix) {
        case 'ph': return 'Phone';
        case 'h2': return 'Phone2';
        case 'h3': return 'Phone3';
        case 'tb': return 'Tablet';
        case 'b2': return 'Tablet2';
        case 'b3': return 'Tablet3';
        case 'pc': return 'Laptop';
        case 'c2': return 'Laptop2';
        case 'c3': return 'Laptop3';
        default: return 'Other';
      }
    };

    const getGroupFromResStatus = (resStatus) => {
      if (!resStatus) return 'NonPRpermanentCode';
      const status = resStatus.toUpperCase().trim();
      if (status === 'PR') return 'Residents';
      if (status === 'SEVA KUTIR') return '1Yr1DeviceUnlimitedData';
      if (status === 'MUMUKSHU' || status === 'GUEST') return 'NonPRpermanentCode';
      return 'NonPRpermanentCode';
    };

    // 3. Format row data and compute values statically (no formulas)
    const rowsData = approvedCodes.map((r) => {
      const username = r.username || '';
      const firstName = deriveFirstName(username, r.CardDb?.issuedto);
      const lastName = deriveLastName(username);
      const alias = `${firstName}_${lastName}`;

      return {
        Account: username,
        Password: r.code || '',
        First_name: firstName,
        Last_name: lastName,
        Alias: alias,
        User_group: getGroupFromResStatus(r.CardDb?.res_status),
        Email: r.CardDb?.email || ''
      };
    });

    const ws = XLSX.utils.json_to_sheet(rowsData);

    XLSX.utils.book_append_sheet(wb, ws, 'Portal Wifi Accounts');

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader(
      'Content-Disposition',
      'attachment; filename=wifi_portal_accounts.xlsx'
    );
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );

    req.log.info('export_portal_wifi_codes_success', { count: approvedCodes.length });
    return res.send(buffer);

  } catch (err) {
    req.log.error('export_portal_wifi_codes_error', { error: err.message });
    return res.status(500).json({ error: 'Failed to export portal WiFi codes: ' + err.message });
  }
};