import {
  STATUS_CASH_PENDING,
  STATUS_CREDITED,
  STATUS_PAYMENT_PENDING
} from '../../config/constants.js';
import { Op } from 'sequelize';
import { QueryTypes } from 'sequelize';
import database from '../../config/database.js';
import XLSX from 'xlsx';
import RazorpaySettlement from '../../models/razorpay_settlement.model.js'; // adjust path if needed
import RazorpaySettlementRecon from '../../models/razorpay_settlement_recon.model.js'; // adjust path if needed

const FOOD_CATEGORIES = ['food', 'breakfast', 'lunch', 'dinner'];

export const fetchCompletedTransactions = async (req, res) => {
  const { startDate, endDate, category, adhyayanId, utsavId } = req.query;

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

  return res.status(200).send({
    message: 'Fetched completed transactions',
    data: transactions
  });
};

export const fetchPendingTransactions = async (req, res) => {
  const { startDate, endDate } = req.query;

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

  return res.status(200).send({
    message: 'Fetched pending transactions',
    data: transactions
  });
};

export const fetchAllCreditTransactions = async (req, res) => {
  const { startDate, endDate } = req.query;

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

  return res.status(200).send({
    message: 'Fetched credits transactions',
    data: transactions
  });
};

// 📥 2. Upload Excel and Insert into razorpay_settlement
import moment from 'moment';

export const uploadRazorpaySettlementExcel = async (req, res) => {
  try {
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheet = XLSX.utils.sheet_to_json(
      workbook.Sheets[workbook.SheetNames[0]],
      { defval: '' }
    );

    const formattedRows = [];

    for (const row of sheet) {
      const rawDate = row.created_at; // ✅ FIXED: Use correct column from Excel

      if (!rawDate) {
        console.warn(`Missing 'created_at' in row with ID ${row.id}`);
        continue;
      }

      const parsedDate = moment(rawDate, 'DD/MM/YYYY HH:mm:ss', true);

      if (!parsedDate.isValid()) {
        console.warn(
          `Invalid date format in row with ID ${row.id}: ${rawDate}`
        );
        continue;
      }

      formattedRows.push({
        id: String(row.id),
        amount: parseFloat(row.amount),
        status: row.status,
        fees: parseFloat(row.fees),
        tax: parseFloat(row.tax),
        utr: row.utr,
        cerated_at: parsedDate.toDate() // ✅ your DB expects this name
      });
    }

    if (formattedRows.length === 0) {
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
      return res
        .status(200)
        .json({ message: 'No new rows to insert. All IDs were duplicates.' });
    }

    await RazorpaySettlement.bulkCreate(uniqueRows);

    res.status(200).json({
      message: `${uniqueRows.length} new record(s) inserted. ${
        formattedRows.length - uniqueRows.length
      } duplicate(s) ignored.`
    });
  } catch (err) {
    console.error('Error processing Excel upload:', err);
    res
      .status(500)
      .json({
        error: 'Failed to process and store Excel data: ' + err.message
      });
  }
};

function safeParseFloat(val) {
  if (val === null || val === undefined) return 0;
  if (typeof val === 'number') return val;
  // Remove commas, currency symbols etc.
  let cleaned = String(val)
    .replace(/[^0-9.-]/g, '')
    .trim();
  let num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

export const updateSettlementFieldsFromExcel = async (req, res) => {
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
        console.warn(`Invalid date in row with order_id ${orderId}, skipping.`);
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

    return res.status(200).json({
      message: `${upserted} record(s) inserted or updated. ${skipped} skipped (invalid or missing fields).`
    });
  } catch (err) {
    console.error('Error updating settlements from Excel:', err);
    res
      .status(500)
      .json({
        error: 'Failed to process and update Excel data: ' + err.message
      });
  }
};

export const fetchAllSettlements = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

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

    res.status(200).json(enrichedSettlements);
  } catch (err) {
    console.error('Error fetching settlements:', err);
    res.status(500).json({ error: 'Failed to fetch settlements' });
  }
};

import { fn, col } from 'sequelize';

export const fetchTransactionsBySettlementId = async (req, res) => {
  const { settlementId } = req.params;

  try {
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

    res.json({ data: transactions || [] });
  } catch (err) {
    console.error('Error fetching transactions:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

export const fetchTransactionsByPaymentId = async (req, res) => {
  const { razorpay_order_id } = req.params;

  try {
    const results = await database.query(
      `
      -- 1. Regular Transactions
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

    return res.json({ data: results });
  } catch (err) {
    console.error('Error fetching transactions by payment id:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

export const fetchCredits = async (req, res) => {
  try {
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
        console.warn(`Invalid credits JSON for cardno ${card.cardno}`);
      }

      return {
        ...card,
        roomCredits: creditValues.room || 0,
        foodCredits: creditValues.food || 0,
        travelCredits: creditValues.travel || 0,
        utsavCredits: creditValues.utsav || 0
      };
    });

    return res.status(200).json({
      message: 'Fetched credit details',
      data: formattedData
    });
  } catch (err) {
    console.error('Error fetching credit details:', err);
    return res.status(500).json({
      message: 'Error fetching credit details',
      error: err.message
    });
  }
};

export const fetchCreditTransactions = async (req, res) => {
  try {
    const { cardno, category } = req.query;

    if (!cardno || !category) {
      return res.status(400).json({
        message: 'cardno and category are required'
      });
    }

    const creditAndDebitTransactions = await database.query(
      `
      SELECT 
        t.cardno,
        t.bookingid,
        t.razorpay_order_id,
        t.amount AS credited_amount,
        NULL AS discount_used,
        t.updatedAt AS date,
        'CREDITED' AS transaction_type
      FROM transactions t
      WHERE t.status = 'credited'
        AND t.cardno = :cardno
        AND t.category = :category

      UNION ALL

      SELECT 
        t.cardno,
        t.bookingid,
        t.razorpay_order_id,
        NULL AS credited_amount,
        t.discount AS discount_used,
        t.createdAt AS date,
        'DEBITED' AS transaction_type
      FROM transactions t
      WHERE t.discount > 0
        AND t.cardno = :cardno
        AND t.category = :category

      ORDER BY date ASC
      `,
      {
        replacements: { cardno, category },
        type: QueryTypes.SELECT,
        raw: true
      }
    );

    return res.status(200).json({
      message: 'Fetched credit/debit transactions successfully',
      data: creditAndDebitTransactions
    });
  } catch (err) {
    console.error('Error in fetchCreditTransactions:', err);
    return res.status(500).json({
      message: 'Internal server error',
      error: err.message
    });
  }
};
