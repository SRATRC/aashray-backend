import {
  STATUS_CASH_PENDING,
  STATUS_CREDITED,
  STATUS_PAYMENT_PENDING
} from '../../config/constants.js';
import {
  Transactions,
  RazorpaySettlement,
  RazorpaySettlementRecon
} from '../../models/associations.js';
import { Op, QueryTypes, fn, col } from 'sequelize';
import database from '../../config/database.js';
import XLSX from 'xlsx';
import moment from 'moment';

const FOOD_CATEGORIES = ['food', 'breakfast', 'lunch', 'dinner'];

export const fetchCompletedTransactions = async (req, res) => {
  const { startDate, endDate, category, adhyayanId, utsavId } = req.query;
  req.log.info('fetch_completed_transactions_start', { startDate, endDate, category, adhyayanId, utsavId });

  let dateFilter = '';
  let categoryFilter = '';
  let adhyayanFilter = '';
  let utsavFilter = '';
  let replacements = {
    status: ['completed', 'cash completed', 'credited']
  };

  if (startDate && endDate) {
    dateFilter = 'AND DATE(t.createdAt) BETWEEN :startDate AND :endDate';
    replacements.startDate = startDate;
    replacements.endDate = endDate;
  }

  if (category && category !== 'all') {
    if (category === 'food') {
      categoryFilter = `AND t.category IN (:foodCategories)`;
      replacements.foodCategories = FOOD_CATEGORIES;
    } else {
      categoryFilter = 'AND t.category = :category';
      replacements.category = category;
    }
  }

  if (category === 'adhyayan' && adhyayanId) {
    adhyayanFilter = 'AND sb.shibir_id = :adhyayanId';
    replacements.adhyayanId = adhyayanId;
  }

  if (category === 'utsav' && utsavId) {
    utsavFilter = 'AND ub.utsavid = :utsavId';
    replacements.utsavId = utsavId;
  }

  const transactions = await database.query(
    `
    SELECT
      t.bookingid,
      t.category,
      CASE
        WHEN t.category = 'room' THEN rb.nights
        WHEN t.category = 'flat' THEN fb.nights
        WHEN t.category IN ('travel', 'utsav', 'adhyayan', 'food', 'breakfast', 'lunch', 'dinner') THEN 1
        ELSE NULL
      END AS quantity,
      t.amount,
      t.discount,
      t.status,
      t.razorpay_order_id,
      t.description,
      CASE WHEN t.category = 'room' THEN rb.checkin
           WHEN t.category = 'flat' THEN fb.checkin
           ELSE '-' END AS checkin,
      CASE WHEN t.category = 'room' THEN rb.checkout
           WHEN t.category = 'flat' THEN fb.checkout
           ELSE '-' END AS checkout,
      bookedby_card.cardno AS bookedBy_cardno,
      bookedby_card.issuedto AS bookedBy_issuedto,
      bookedby_card.address AS bookedBy_address,
      bookedby_card.email AS bookedBy_email,
      bookedby_card.mobno AS bookedBy_mobno,
      COALESCE(
        shibir_card.cardno, utsav_card.cardno, room_card.cardno, flat_card.cardno, travel_card.cardno, food_card.cardno
      ) AS bookedFor_cardno,
      COALESCE(
        shibir_card.issuedto, utsav_card.issuedto, room_card.issuedto, flat_card.issuedto, travel_card.issuedto, food_card.issuedto
      ) AS bookedFor_issuedto,
      COALESCE(
        shibir_card.address, utsav_card.address, room_card.address, flat_card.address, travel_card.address, food_card.address
      ) AS bookedFor_address,
      COALESCE(
        shibir_card.email, utsav_card.email, room_card.email, flat_card.email, travel_card.email, food_card.email
      ) AS bookedFor_email,
      COALESCE(
        shibir_card.mobno, utsav_card.mobno, room_card.mobno, flat_card.mobno, travel_card.mobno, food_card.mobno
      ) AS bookedFor_mobno
    FROM transactions t
    JOIN card_db bookedby_card ON bookedby_card.cardno = t.cardno
    LEFT JOIN shibir_booking_db sb ON sb.bookingid = t.bookingid AND t.category = 'adhyayan'
    LEFT JOIN room_booking rb ON rb.bookingid = t.bookingid AND t.category = 'room'
    LEFT JOIN flat_booking fb ON fb.bookingid = t.bookingid AND t.category = 'flat'
    LEFT JOIN travel_db tb ON tb.bookingid = t.bookingid AND t.category = 'travel'
    LEFT JOIN utsav_booking ub ON ub.bookingid = t.bookingid AND t.category = 'utsav'
    LEFT JOIN card_db shibir_card ON shibir_card.cardno = sb.cardno AND t.category = 'adhyayan'
    LEFT JOIN card_db utsav_card ON utsav_card.cardno = ub.cardno AND t.category = 'utsav'
    LEFT JOIN card_db room_card ON room_card.cardno = rb.cardno AND t.category = 'room'
    LEFT JOIN card_db flat_card ON flat_card.cardno = fb.cardno AND t.category = 'flat'
    LEFT JOIN card_db travel_card ON travel_card.cardno = tb.cardno AND t.category = 'travel'
    LEFT JOIN card_db food_card ON food_card.cardno = t.cardno AND t.category IN ('food', 'breakfast', 'lunch', 'dinner')
    WHERE t.status IN (:status)
    ${dateFilter}
    ${categoryFilter}
    ${adhyayanFilter}
    ${utsavFilter}
    `,
    {
      type: QueryTypes.SELECT,
      raw: true,
      replacements
    }
  );

  req.log.info('fetch_completed_transactions_success', { count: transactions.length });
  return res.status(200).send({
    message: 'Fetched completed transactions',
    data: transactions
  });
};

export const fetchPendingTransactions = async (req, res) => {
  const { startDate, endDate } = req.query;
  req.log.info('fetch_pending_transactions_start', { startDate, endDate });

  let dateFilter = '';
  let replacements = {
    status: [STATUS_CASH_PENDING, STATUS_PAYMENT_PENDING],
    foodCategories: FOOD_CATEGORIES
  };

  if (startDate && endDate) {
    dateFilter = 'AND DATE(t.createdAt) BETWEEN :startDate AND :endDate';
    replacements.startDate = startDate;
    replacements.endDate = endDate;
  }

  const transactions = await database.query(
    `
    SELECT
      t.bookingid,
      t.category,
      CASE
        WHEN t.category = 'room' THEN rb.nights
        WHEN t.category = 'flat' THEN fb.nights
        WHEN t.category IN ('travel', 'utsav', 'adhyayan', 'food', 'breakfast', 'lunch', 'dinner') THEN 1
        ELSE NULL
      END AS quantity,
      t.amount,
      t.discount,
      t.status,
      t.razorpay_order_id,
      t.description,
      CASE WHEN t.category = 'room' THEN rb.checkin
           WHEN t.category = 'flat' THEN fb.checkin
           ELSE '-' END AS checkin,
      CASE WHEN t.category = 'room' THEN rb.checkout
           WHEN t.category = 'flat' THEN fb.checkout
           ELSE '-' END AS checkout,
      bookedby_card.cardno AS bookedBy_cardno,
      bookedby_card.issuedto AS bookedBy_issuedto,
      bookedby_card.address AS bookedBy_address,
      bookedby_card.email AS bookedBy_email,
      bookedby_card.mobno AS bookedBy_mobno,
      COALESCE(
        shibir_card.cardno, utsav_card.cardno, room_card.cardno, flat_card.cardno, travel_card.cardno, food_card.cardno
      ) AS bookedFor_cardno,
      COALESCE(
        shibir_card.issuedto, utsav_card.issuedto, room_card.issuedto, flat_card.issuedto, travel_card.issuedto, food_card.issuedto
      ) AS bookedFor_issuedto,
      COALESCE(
        shibir_card.address, utsav_card.address, room_card.address, flat_card.address, travel_card.address, food_card.address
      ) AS bookedFor_address,
      COALESCE(
        shibir_card.email, utsav_card.email, room_card.email, flat_card.email, travel_card.email, food_card.email
      ) AS bookedFor_email,
      COALESCE(
        shibir_card.mobno, utsav_card.mobno, room_card.mobno, flat_card.mobno, travel_card.mobno, food_card.mobno
      ) AS bookedFor_mobno
    FROM transactions t
    JOIN card_db bookedby_card ON bookedby_card.cardno = t.cardno
    LEFT JOIN shibir_booking_db sb ON sb.bookingid = t.bookingid AND t.category = 'adhyayan'
    LEFT JOIN room_booking rb ON rb.bookingid = t.bookingid AND t.category = 'room'
    LEFT JOIN flat_booking fb ON fb.bookingid = t.bookingid AND t.category = 'flat'
    LEFT JOIN travel_db tb ON tb.bookingid = t.bookingid AND t.category = 'travel'
    LEFT JOIN utsav_booking ub ON ub.bookingid = t.bookingid AND t.category = 'utsav'
    LEFT JOIN card_db shibir_card ON shibir_card.cardno = sb.cardno AND t.category = 'adhyayan'
    LEFT JOIN card_db utsav_card ON utsav_card.cardno = ub.cardno AND t.category = 'utsav'
    LEFT JOIN card_db room_card ON room_card.cardno = rb.cardno AND t.category = 'room'
    LEFT JOIN card_db flat_card ON flat_card.cardno = fb.cardno AND t.category = 'flat'
    LEFT JOIN card_db travel_card ON travel_card.cardno = tb.cardno AND t.category = 'travel'
    LEFT JOIN card_db food_card ON food_card.cardno = t.cardno AND t.category IN (:foodCategories)
    WHERE t.status IN (:status)
    ${dateFilter}
    `,
    {
      type: QueryTypes.SELECT,
      raw: true,
      replacements
    }
  );

  req.log.info('fetch_pending_transactions_success', { count: transactions.length });
  return res.status(200).send({
    message: 'Fetched pending transactions',
    data: transactions
  });
};

export const fetchAllCreditTransactions = async (req, res) => {
  const { startDate, endDate } = req.query;
  req.log.info('fetch_credit_transactions_start', { startDate, endDate });

  let dateFilter = '';
  let replacements = {
    status: [STATUS_CREDITED],
    foodCategories: FOOD_CATEGORIES
  };

  if (startDate && endDate) {
    dateFilter = 'AND DATE(t.updatedAt) BETWEEN :startDate AND :endDate';
    replacements.startDate = startDate;
    replacements.endDate = endDate;
  }

  const transactions = await database.query(
    `
    SELECT
      t.bookingid,
      t.category,
      CASE
        WHEN t.category = 'room' THEN rb.nights
        WHEN t.category = 'flat' THEN fb.nights
        WHEN t.category IN ('travel', 'utsav', 'adhyayan', 'food', 'breakfast', 'lunch', 'dinner') THEN 1
        ELSE NULL
      END AS quantity,
      t.amount,
      t.discount,
      t.status,
      t.razorpay_order_id,
      t.createdAt,
      t.updatedAt,
      t.description,
      CASE WHEN t.category = 'room' THEN rb.checkin
           WHEN t.category = 'flat' THEN fb.checkin
           ELSE '-' END AS checkin,
      CASE WHEN t.category = 'room' THEN rb.checkout
           WHEN t.category = 'flat' THEN fb.checkout
           ELSE '-' END AS checkout,
      bookedby_card.cardno AS bookedBy_cardno,
      bookedby_card.issuedto AS bookedBy_issuedto,
      bookedby_card.address AS bookedBy_address,
      bookedby_card.email AS bookedBy_email,
      bookedby_card.mobno AS bookedBy_mobno,
      COALESCE(
        shibir_card.cardno, utsav_card.cardno, room_card.cardno, flat_card.cardno, travel_card.cardno, food_card.cardno
      ) AS bookedFor_cardno,
      COALESCE(
        shibir_card.issuedto, utsav_card.issuedto, room_card.issuedto, flat_card.issuedto, travel_card.issuedto, food_card.issuedto
      ) AS bookedFor_issuedto,
      COALESCE(
        shibir_card.address, utsav_card.address, room_card.address, flat_card.address, travel_card.address, food_card.address
      ) AS bookedFor_address,
      COALESCE(
        shibir_card.email, utsav_card.email, room_card.email, flat_card.email, travel_card.email, food_card.email
      ) AS bookedFor_email,
      COALESCE(
        shibir_card.mobno, utsav_card.mobno, room_card.mobno, flat_card.mobno, travel_card.mobno, food_card.mobno
      ) AS bookedFor_mobno
    FROM transactions t
    JOIN card_db bookedby_card ON bookedby_card.cardno = t.cardno
    LEFT JOIN shibir_booking_db sb ON t.bookingid = sb.bookingid AND t.category = 'adhyayan'
    LEFT JOIN room_booking rb ON t.bookingid = rb.bookingid AND t.category = 'room'
    LEFT JOIN flat_booking fb ON t.bookingid = fb.bookingid AND t.category = 'flat'
    LEFT JOIN travel_db tb ON t.bookingid = tb.bookingid AND t.category = 'travel'
    LEFT JOIN utsav_booking ub ON t.bookingid = ub.bookingid AND t.category = 'utsav'
    LEFT JOIN card_db shibir_card ON shibir_card.cardno = sb.cardno AND t.category = 'adhyayan'
    LEFT JOIN card_db utsav_card ON utsav_card.cardno = ub.cardno AND t.category = 'utsav'
    LEFT JOIN card_db room_card ON room_card.cardno = rb.cardno AND t.category = 'room'
    LEFT JOIN card_db flat_card ON flat_card.cardno = fb.cardno AND t.category = 'flat'
    LEFT JOIN card_db travel_card ON travel_card.cardno = tb.cardno AND t.category = 'travel'
    LEFT JOIN card_db food_card ON food_card.cardno = t.cardno AND t.category IN (:foodCategories)
    WHERE t.status IN (:status)
    ${dateFilter}
    `,
    {
      type: QueryTypes.SELECT,
      raw: true,
      replacements
    }
  );

  req.log.info('fetch_credit_transactions_success', { count: transactions.length });
  return res.status(200).send({
    message: 'Fetched credits transactions',
    data: transactions
  });
};

export const uploadRazorpaySettlementExcel = async (req, res) => {
  req.log.info('upload_razorpay_settlement_excel_start', { filename: req.file?.originalname });

  const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
  const sheet = XLSX.utils.sheet_to_json(
    workbook.Sheets[workbook.SheetNames[0]],
    { defval: '' }
  );

  const formattedRows = [];

  for (const row of sheet) {
    const rawDate = row.created_at;

    if (!rawDate) {
      req.log.warn('upload_razorpay_settlement_missing_date', { rowId: row.id });
      continue;
    }

    const parsedDate = moment(rawDate, 'DD/MM/YYYY HH:mm:ss', true);

    if (!parsedDate.isValid()) {
      req.log.warn('upload_razorpay_settlement_invalid_date', { rowId: row.id, rawDate });
      continue;
    }

    formattedRows.push({
      id: String(row.id),
      amount: parseFloat(row.amount),
      status: row.status,
      fees: parseFloat(row.fees),
      tax: parseFloat(row.tax),
      utr: row.utr,
      cerated_at: parsedDate.toDate()
    });
  }

  if (formattedRows.length === 0) {
    req.log.warn('upload_razorpay_settlement_no_valid_rows');
    return res
      .status(400)
      .json({ error: 'No valid rows found with correct date format.' });
  }

  const incomingIds = formattedRows.map((row) => row.id);

  const existingRecords = await RazorpaySettlement.findAll({
    where: { id: incomingIds },
    attributes: ['id'],
    raw: true
  });

  const existingIds = new Set(existingRecords.map((r) => r.id));
  const uniqueRows = formattedRows.filter((row) => !existingIds.has(row.id));

  if (uniqueRows.length === 0) {
    req.log.info('upload_razorpay_settlement_all_duplicates', { totalRows: formattedRows.length });
    return res
      .status(200)
      .json({ message: 'No new rows to insert. All IDs were duplicates.' });
  }

  await RazorpaySettlement.bulkCreate(uniqueRows);

  req.log.info('upload_razorpay_settlement_success', {
    inserted: uniqueRows.length,
    duplicates: formattedRows.length - uniqueRows.length
  });
  res.status(200).json({
    message: `${uniqueRows.length} new record(s) inserted. ${
      formattedRows.length - uniqueRows.length
    } duplicate(s) ignored.`
  });
};

export const updateSettlementFieldsFromExcel = async (req, res) => {
  req.log.info('update_settlement_fields_from_excel_start', { filename: req.file?.originalname });

  try {
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheet = XLSX.utils.sheet_to_json(
      workbook.Sheets[workbook.SheetNames[0]],
      { defval: '' }
    );

    const safeParseFloat = (val) => {
      if (val == null || val === '') return 0;
      const cleaned = String(val)
        .replace(/[^0-9.-]/g, '')
        .trim();
      const num = parseFloat(cleaned);
      return isNaN(num) ? 0 : num;
    };

    let upserted = 0;
    let skipped = 0;

    for (const row of sheet) {
      const orderId = row['order_id'];
      const paymentId = row['entity_id'];

      if (!orderId || !paymentId) {
        skipped++;
        continue;
      }

      const settledAtRaw = row['settled_at'];
      const settledAt = moment(
        settledAtRaw,
        ['DD/MM/YYYY HH:mm:ss', moment.ISO_8601],
        true
      );

      if (!settledAt.isValid()) {
        req.log.warn('update_settlement_invalid_date', { orderId });
        skipped++;
        continue;
      }

      await database.models.RazorpaySettlementRecon.upsert({
        order_id: orderId,
        payment_id: paymentId,
        amount: safeParseFloat(row['amount']),
        fees: safeParseFloat(row['fee (exclusive tax)']),
        tax: safeParseFloat(row['tax']),
        credit_amount: safeParseFloat(row['credit']),
        payment_notes: row['order_notes'] || null,
        settlement_id: row['settlement_id'] || null,
        settled_at: settledAt.toDate(),
        settlement_utr: row['settlement_utr'] || null,
        settled_by: row['settled_by'] || null
      });

      upserted++;
    }

    req.log.info('update_settlement_fields_from_excel_success', { upserted, skipped });
    return res.status(200).json({
      message: `${upserted} record(s) inserted or updated. ${skipped} skipped (invalid or missing fields).`
    });
  } catch (err) {
    req.log.error('update_settlement_fields_from_excel_error', { error: err.message });
    res.status(500).json({
      error: 'Failed to process and update Excel data: ' + err.message
    });
  }
};

export const fetchAllSettlements = async (req, res) => {
  const { startDate, endDate } = req.query;
  req.log.info('fetch_all_settlements_start', { startDate, endDate });

  try {
    const whereClause = {};
    if (startDate && endDate) {
      whereClause.cerated_at = {
        [Op.between]: [new Date(startDate), new Date(endDate)]
      };
    }

    // Step 1: Fetch settlements
    const settlements = await RazorpaySettlement.findAll({
      where: whereClause,
      order: [['cerated_at', 'DESC']],
      raw: true
    });

    if (!settlements.length) {
      req.log.info('fetch_all_settlements_empty');
      return res.status(200).json([]);
    }

    const settlementIds = settlements.map((s) => s.id);

    // Step 2: Fetch total fees & tax from recon table grouped by settlement_id
    const reconTotals = await RazorpaySettlementRecon.findAll({
      attributes: [
        'settlement_id',
        [fn('SUM', col('fees')), 'totalFees'],
        [fn('SUM', col('tax')), 'totalTax']
      ],
      where: {
        settlement_id: { [Op.in]: settlementIds }
      },
      group: ['settlement_id'],
      raw: true
    });

    const reconMap = {};
    reconTotals.forEach((r) => {
      reconMap[r.settlement_id] = {
        totalFees: parseFloat(r.totalFees) || 0,
        totalTax: parseFloat(r.totalTax) || 0
      };
    });

    // Step 3: Merge recon data into settlements
    const enrichedSettlements = settlements.map((s) => ({
      ...s,
      fees: reconMap[s.id]?.totalFees || 0,
      tax: reconMap[s.id]?.totalTax || 0
    }));

    req.log.info('fetch_all_settlements_success', { count: enrichedSettlements.length });
    res.status(200).json(enrichedSettlements);
  } catch (err) {
    req.log.error('fetch_all_settlements_error', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch settlements' });
  }
};

export const fetchTransactionsBySettlementId = async (req, res) => {
  const { settlementId } = req.params;
  req.log.info('fetch_transactions_by_settlement_start', { settlementId });

  const transactions = await database.query(
    `
      -- 1. Matched transactions + recon
      SELECT
        t.razorpay_order_id,
        SUM(t.amount) AS totalAmount,
        SUM(t.discount) AS totalDiscount, -- ✅ Added
        COUNT(t.razorpay_order_id) AS transactionCount,
        ROUND(SUM(r.fees), 2) AS totalFees,
        ROUND(SUM(r.tax), 2) AS totalTax,
        ROUND(SUM(r.credit_amount), 2) AS totalCreditAmount,
        'Aashray App Transaction' AS source
      FROM transactions t
      JOIN razorpay_settlement_recon r
        ON t.razorpay_order_id = r.order_id
      WHERE r.settlement_id = :settlementId
      GROUP BY t.razorpay_order_id

      UNION

      -- 2. Recon-only (not in transactions)
SELECT
  r.order_id AS razorpay_order_id,
  MAX(CAST(JSON_UNQUOTE(JSON_EXTRACT(rw.json, '$.payload.payment.entity.amount')) AS UNSIGNED)) / 100 AS totalAmount,
  0 AS totalDiscount,
  1 AS transactionCount,
  ROUND(SUM(r.fees), 2) AS totalFees,
  ROUND(SUM(r.tax), 2) AS totalTax,
  ROUND(SUM(r.credit_amount), 2) AS totalCreditAmount,
  'Satshrut Transaction' AS source
FROM razorpay_settlement_recon r

LEFT JOIN razorpay_webhook rw
  ON rw.order_id = r.order_id AND rw.status = 'captured'

WHERE r.settlement_id = :settlementId
  AND r.order_id NOT IN (
    SELECT DISTINCT razorpay_order_id FROM transactions WHERE razorpay_order_id IS NOT NULL
  )

GROUP BY r.order_id
`,
    {
      type: QueryTypes.SELECT,
      replacements: { settlementId }
    }
  );

  req.log.info('fetch_transactions_by_settlement_success', { settlementId, count: transactions.length });
  res.json({ data: transactions || [] });
};

export const fetchTransactionsByPaymentId = async (req, res) => {
  const { razorpay_order_id } = req.params;
  req.log.info('fetch_transactions_by_payment_start', { razorpay_order_id });

  const results = await database.query(
    `
      -- 1. Regular Transactions
      SELECT
        t.bookingid,
        t.category,

        CASE
          WHEN t.category = 'utsav' THEN ub.utsavid
          ELSE '-'
        END AS utsav_id,

        CASE
          WHEN t.category = 'room' THEN rb.nights
          WHEN t.category = 'flat' THEN fb.nights
          WHEN t.category IN ('travel', 'utsav', 'adhyayan', 'food', 'breakfast', 'lunch', 'dinner') THEN 1
          ELSE NULL
        END AS quantity,
        t.amount,
        t.discount,
        t.status,
        t.razorpay_order_id,
        t.description,

        CASE
          WHEN t.category = 'room' THEN rb.checkin
          WHEN t.category = 'flat' THEN fb.checkin
          ELSE '-'
        END AS checkin,

        CASE
          WHEN t.category = 'room' THEN rb.checkout
          WHEN t.category = 'flat' THEN fb.checkout
          ELSE '-'
        END AS checkout,

        CASE WHEN t.category = 'adhyayan' THEN s.comments ELSE '-' END AS shibir_comments,

        COALESCE(rs.cerated_at, '-') AS settlementDate,
        rs.id AS settlement_id,

        -- BookedBy
        bookedby_card.cardno AS bookedBy_cardno,
        bookedby_card.issuedto AS bookedBy_issuedto,
        bookedby_card.address AS bookedBy_address,
        bookedby_card.email AS bookedBy_email,
        bookedby_card.mobno AS bookedBy_mobno,

        -- BookedFor
        COALESCE(
          shibir_card.cardno, utsav_card.cardno, room_card.cardno, travel_card.cardno, food_card.cardno, flat_card.cardno
        ) AS bookedFor_cardno,
        COALESCE(
          shibir_card.issuedto, utsav_card.issuedto, room_card.issuedto, travel_card.issuedto, food_card.issuedto, flat_card.issuedto
        ) AS bookedFor_issuedto,
        COALESCE(
          shibir_card.address, utsav_card.address, room_card.address, travel_card.address, food_card.address, flat_card.address
        ) AS bookedFor_address,
        COALESCE(
          shibir_card.email, utsav_card.email, room_card.email, travel_card.email, food_card.email, flat_card.email
        ) AS bookedFor_email,
        COALESCE(
          shibir_card.mobno, utsav_card.mobno, room_card.mobno, travel_card.mobno, food_card.mobno, flat_card.mobno
        ) AS bookedFor_mobno

      FROM transactions t

      JOIN card_db bookedby_card ON bookedby_card.cardno = t.cardno

      -- Booking table joins
      LEFT JOIN shibir_booking_db sb ON t.bookingid = sb.bookingid AND t.category = 'adhyayan'
      LEFT JOIN shibir_db s ON sb.shibir_id = s.id AND t.category = 'adhyayan'
      LEFT JOIN room_booking rb ON t.bookingid = rb.bookingid AND t.category = 'room'
      LEFT JOIN flat_booking fb ON t.bookingid = fb.bookingid AND t.category = 'flat'
      LEFT JOIN travel_db tb ON t.bookingid = tb.bookingid AND t.category = 'travel'
      LEFT JOIN utsav_booking ub ON t.bookingid = ub.bookingid AND t.category = 'utsav'

      -- BookedFor joins
      LEFT JOIN card_db shibir_card ON shibir_card.cardno = sb.cardno AND t.category = 'adhyayan'
      LEFT JOIN card_db utsav_card ON utsav_card.cardno = ub.cardno AND t.category = 'utsav'
      LEFT JOIN card_db room_card ON room_card.cardno = rb.cardno AND t.category = 'room'
      LEFT JOIN card_db flat_card ON flat_card.cardno = fb.cardno AND t.category = 'flat'
      LEFT JOIN card_db travel_card ON travel_card.cardno = tb.cardno AND t.category = 'travel'
      LEFT JOIN card_db food_card ON food_card.cardno = t.cardno AND t.category IN ('food', 'breakfast', 'lunch', 'dinner')

      LEFT JOIN razorpay_settlement_recon rsr ON rsr.order_id = t.razorpay_order_id
      LEFT JOIN razorpay_settlement rs ON rs.id = rsr.settlement_id

      WHERE t.status IN (:status)
        AND t.razorpay_order_id = :razorpay_order_id

      UNION ALL

      -- 2. Satshrut Transactions from Webhook (only captured)
      SELECT
        CAST(JSON_UNQUOTE(JSON_EXTRACT(rw.json, '$.account_id')) AS CHAR) COLLATE utf8mb4_general_ci AS bookingid,
         '-' COLLATE utf8mb4_general_ci AS utsav_id,
        'satshrut' COLLATE utf8mb4_general_ci AS category,
        1 AS quantity,
        CAST(JSON_UNQUOTE(JSON_EXTRACT(rw.json, '$.payload.payment.entity.amount')) AS UNSIGNED) / 100 AS amount,
        NULL AS discount,
        'completed' COLLATE utf8mb4_general_ci AS status,
        rw.order_id COLLATE utf8mb4_general_ci AS razorpay_order_id,
        'Satshrut Transaction' COLLATE utf8mb4_general_ci AS description,

        '-' COLLATE utf8mb4_general_ci AS checkin,
        '-' COLLATE utf8mb4_general_ci AS checkout,
        '-' COLLATE utf8mb4_general_ci AS shibir_comments,

        COALESCE(rs.cerated_at, '-') AS settlementDate,
        rs.id AS settlement_id,

        cb.cardno AS bookedBy_cardno,
        cb.issuedto AS bookedBy_issuedto,
        cb.address AS bookedBy_address,
        cb.email AS bookedBy_email,
        cb.mobno AS bookedBy_mobno,

        '-' COLLATE utf8mb4_general_ci AS bookedFor_cardno,
        '-' COLLATE utf8mb4_general_ci AS bookedFor_issuedto,
        '-' COLLATE utf8mb4_general_ci AS bookedFor_address,
        '-' COLLATE utf8mb4_general_ci AS bookedFor_email,
        '-' COLLATE utf8mb4_general_ci AS bookedFor_mobno

      FROM razorpay_webhook rw
      LEFT JOIN razorpay_settlement_recon rsr ON rsr.order_id = rw.order_id
      LEFT JOIN razorpay_settlement rs ON rs.id = rsr.settlement_id
      LEFT JOIN card_db cb ON cb.mobno = RIGHT(JSON_UNQUOTE(JSON_EXTRACT(rw.json, '$.payload.payment.entity.contact')), 10)

      WHERE rw.order_id = :razorpay_order_id
        AND rw.status = 'captured'
        AND NOT EXISTS (
          SELECT 1 FROM transactions t2
          WHERE BINARY TRIM(t2.razorpay_order_id) = BINARY TRIM(rw.order_id)
        )
      `,
    {
      type: QueryTypes.SELECT,
      raw: true,
      replacements: {
        status: ['completed', 'cash completed', 'credited'],
        razorpay_order_id
      }
    }
  );

  req.log.info('fetch_transactions_by_payment_success', { razorpay_order_id, count: results.length });
  return res.json({ data: results });
};

export const fetchCredits = async (req, res) => {
  req.log.info('fetch_credits_start');

  const cardholders = await database.query(
    `
      SELECT
        cardno,
        issuedto,
        address,
        email,
        mobno,
        credits
      FROM card_db
      WHERE credits IS NOT NULL
        AND TRIM(credits) != ''
        AND credits != '{}'
      ORDER BY issuedto
      `,
    {
      type: QueryTypes.SELECT,
      raw: true
    }
  );

  // Optional: parse credits JSON and attach separate fields
  const formattedData = cardholders.map((card) => {
    let creditValues = {};

    try {
      creditValues = JSON.parse(card.credits || '{}');
    } catch (e) {
      req.log.warn('fetch_credits_invalid_json', { cardno: card.cardno });
    }

    return {
      ...card,
      roomCredits: creditValues.room || 0,
      foodCredits: creditValues.food || 0,
      travelCredits: creditValues.travel || 0,
      utsavCredits: creditValues.utsav || 0
    };
  });

  req.log.info('fetch_credits_success', { count: formattedData.length });
  return res.status(200).json({
    message: 'Fetched credit details',
    data: formattedData
  });
};

export const fetchCreditTransactions = async (req, res) => {
  const { cardno, category } = req.query;
  req.log.info('fetch_credit_transactions_by_card_start', { cardno, category });

  if (!cardno || !category) {
    req.log.warn('fetch_credit_transactions_by_card_missing_params', { cardno, category });
    return res.status(400).json({
      message: 'cardno and category are required'
    });
  }

  // Fetch all transactions relevant to this cardno (from all categories)
  const allTransactions = await Transactions.findAll({
    where: {
      cardno,
      [Op.or]: [
        { status: 'credited' },
        {
          status: 'completed',
          description: { [Op.like]: '%credits used:%' }
        }
      ]
    },
    order: [['createdAt', 'ASC']],
    raw: true
  });

  let remainingCredits = 0;
  const formatted = [];

  for (const t of allTransactions) {
    const actualCategory = t.category;
    const isUsed =
      t.status === 'completed' &&
      t.description?.toLowerCase().includes('credits used');

    const isMeal = (cat) => ['breakfast', 'lunch', 'dinner'].includes(cat);

    const categoryMatch = (actualCategory, queryCategory) => {
      if (queryCategory === 'food') return isMeal(actualCategory);
      return actualCategory === queryCategory;
    };

    if (t.status === 'credited' && categoryMatch(actualCategory, category)) {
      remainingCredits += t.amount;

      formatted.push({
        cardno: t.cardno,
        bookingid: t.bookingid,
        razorpay_order_id: t.razorpay_order_id || null,
        date: t.updatedAt || t.createdAt,
        credited_amount: t.amount,
        credits_used: null,
        amount_paid: 0,
        transaction_type: 'CREDITED',
        remaining_credit: remainingCredits
      });
    }
    // Case 2: Used credits
    else if (isUsed) {
      const match = t.description?.match(/credits used:\s*(\d+)/i);
      const used = match ? parseInt(match[1]) : 0;

      const isFlatBooking = actualCategory === 'flat';
      const deductFromCategory = isFlatBooking ? 'room' : actualCategory;

      if (categoryMatch(deductFromCategory, category)) {
        remainingCredits -= used;

        formatted.push({
          cardno: t.cardno,
          bookingid: t.bookingid,
          razorpay_order_id: t.razorpay_order_id || null,
          date: t.createdAt,
          credited_amount: null,
          credits_used: used,
          amount_paid: t.amount || 0,
          transaction_type: 'USED',
          remaining_credit: remainingCredits
        });
      }
    }
  }

  req.log.info('fetch_credit_transactions_by_card_success', { cardno, category, count: formatted.length });
  return res.status(200).json({
    message: 'Fetched credit usage history successfully',
    data: formatted
  });
};

export const fetchAllDebitTransactions = async (req, res) => {
  const { startDate, endDate } = req.query;
  req.log.info('fetch_debit_transactions_start', { startDate, endDate });

  let dateFilter = '';
  let replacements = {
    status: [STATUS_CREDITED],
    foodCategories: FOOD_CATEGORIES
  };

  if (startDate && endDate) {
    dateFilter = 'AND DATE(t.createdAt) BETWEEN :startDate AND :endDate';
    replacements.startDate = startDate;
    replacements.endDate = endDate;
  }

  const transactions = await database.query(
    `
    SELECT
      t.bookingid,
      t.category,
      CASE
        WHEN t.category = 'room' THEN rb.nights
        WHEN t.category = 'flat' THEN fb.nights
        WHEN t.category IN ('travel', 'utsav', 'adhyayan', 'food', 'breakfast', 'lunch', 'dinner') THEN 1
        ELSE NULL
      END AS quantity,
      t.amount,
      t.discount,
      t.status,
      t.razorpay_order_id,
      t.createdAt,
      t.updatedAt,
      t.description,
      CASE WHEN t.category = 'room' THEN rb.checkin
           WHEN t.category = 'flat' THEN fb.checkin
           ELSE '-' END AS checkin,
      CASE WHEN t.category = 'room' THEN rb.checkout
           WHEN t.category = 'flat' THEN fb.checkout
           ELSE '-' END AS checkout,
      COALESCE(
  JSON_UNQUOTE(JSON_EXTRACT(bookedby_card.credits, CONCAT('$.', t.category))),
  '0'
) AS credits_remaining,
bookedby_card.cardno AS bookedBy_cardno,
      bookedby_card.issuedto AS bookedBy_issuedto,
      bookedby_card.address AS bookedBy_address,
      bookedby_card.email AS bookedBy_email,
      bookedby_card.mobno AS bookedBy_mobno,
      COALESCE(
        shibir_card.cardno, utsav_card.cardno, room_card.cardno, flat_card.cardno, travel_card.cardno, food_card.cardno
      ) AS bookedFor_cardno,
      COALESCE(
        shibir_card.issuedto, utsav_card.issuedto, room_card.issuedto, flat_card.issuedto, travel_card.issuedto, food_card.issuedto
      ) AS bookedFor_issuedto,
      COALESCE(
        shibir_card.address, utsav_card.address, room_card.address, flat_card.address, travel_card.address, food_card.address
      ) AS bookedFor_address,
      COALESCE(
        shibir_card.email, utsav_card.email, room_card.email, flat_card.email, travel_card.email, food_card.email
      ) AS bookedFor_email,
      COALESCE(
        shibir_card.mobno, utsav_card.mobno, room_card.mobno, flat_card.mobno, travel_card.mobno, food_card.mobno
      ) AS bookedFor_mobno
    FROM transactions t
    JOIN card_db bookedby_card ON bookedby_card.cardno = t.cardno
    LEFT JOIN shibir_booking_db sb ON t.bookingid = sb.bookingid AND t.category = 'adhyayan'
    LEFT JOIN room_booking rb ON t.bookingid = rb.bookingid AND t.category = 'room'
    LEFT JOIN flat_booking fb ON t.bookingid = fb.bookingid AND t.category = 'flat'
    LEFT JOIN travel_db tb ON t.bookingid = tb.bookingid AND t.category = 'travel'
    LEFT JOIN utsav_booking ub ON t.bookingid = ub.bookingid AND t.category = 'utsav'
    LEFT JOIN card_db shibir_card ON shibir_card.cardno = sb.cardno AND t.category = 'adhyayan'
    LEFT JOIN card_db utsav_card ON utsav_card.cardno = ub.cardno AND t.category = 'utsav'
    LEFT JOIN card_db room_card ON room_card.cardno = rb.cardno AND t.category = 'room'
    LEFT JOIN card_db flat_card ON flat_card.cardno = fb.cardno AND t.category = 'flat'
    LEFT JOIN card_db travel_card ON travel_card.cardno = tb.cardno AND t.category = 'travel'
    LEFT JOIN card_db food_card ON food_card.cardno = t.cardno AND t.category IN (:foodCategories)
WHERE (
  t.status IN (:status)
  OR (
    t.status = 'completed'
    AND t.description LIKE 'credits used: %'
  )
)
AND t.status != 'credited'
${dateFilter}
    `,
    {
      type: QueryTypes.SELECT,
      raw: true,
      replacements
    }
  );

  req.log.info('fetch_debit_transactions_success', { count: transactions.length });
  return res.status(200).send({
    message: 'Fetched credits transactions',
    data: transactions
  });
};
