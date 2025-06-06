import {
  STATUS_PAYMENT_COMPLETED,
  STATUS_CASH_COMPLETED,
  STATUS_CASH_PENDING,
  STATUS_CREDITED,
  STATUS_PAYMENT_PENDING
} from '../../config/constants.js';

import Sequelize, { QueryTypes } from 'sequelize';
import database from '../../config/database.js';
import XLSX from 'xlsx';
import RazorpaySettlement from '../../models/razorpay_settlement.model.js'; // adjust path if needed
import Transactions from '../../models/transactions.model.js'; // adjust path if needed

// 📄 1. Fetch Completed Transactions
// export const fetchCompletedTransactions = async (req, res) => {
//   const { startDate, endDate } = req.query;

//   let dateFilter = '';
//   let replacements = {
//     status: [
//       STATUS_PAYMENT_COMPLETED,
//       STATUS_CASH_COMPLETED
//     ]
//   };

//   if (startDate && endDate) {
//     dateFilter = 'AND DATE(t.createdAt) BETWEEN :startDate AND :endDate';
//     replacements.startDate = startDate;
//     replacements.endDate = endDate;
//   }

//   const transactions = await database.query(
//     `
//       SELECT
//         t.bookingid,
//         t.category,
//         CASE 
//             WHEN t.category = 'room' THEN rb.nights
//             WHEN t.category IN ('travel', 'utsav', 'adhyayan', 'food') THEN 1
//             ELSE NULL
//         END AS quantity,
//         t.amount,
//         t.discount,
//         t.status,
//         t.razorpay_order_id,
//         COALESCE(cb.cardno, c.cardno) AS bookedBy_cardno,
//         COALESCE(cb.issuedto, c.issuedto) AS bookedBy_issuedto,
//         COALESCE(cb.address, c.address) AS bookedBy_address,
//         COALESCE(cb.email, c.email) AS bookedBy_email,
//         COALESCE(cb.mobno, c.mobno) AS bookedBy_mobno,
//         c.cardno AS bookedFor_cardno,
//         c.issuedto AS bookedFor_issuedto,
//         c.address AS bookedFor_address,
//         c.email AS bookedFor_email,
//         c.mobno AS bookedFor_mobno
//       FROM transactions t
//       JOIN card_db c ON c.cardno = t.cardno
//       LEFT JOIN shibir_booking_db sb ON t.bookingid = sb.bookingid AND t.category = 'adhyayan'
//       LEFT JOIN room_booking rb ON t.bookingid = rb.bookingid AND t.category = 'room'
//       LEFT JOIN travel_db tb ON t.bookingid = tb.bookingid AND t.category = 'travel'
//       LEFT JOIN utsav_booking ub ON t.bookingid = ub.bookingid AND t.category = 'utsav'
//       LEFT JOIN card_db cb ON cb.cardno = COALESCE(sb.bookedBy, rb.bookedBy, tb.bookedBy, ub.bookedBy)
//       WHERE t.status IN ('completed', 'cash completed')
//       ${dateFilter}
//     `,
//     {
//       type: QueryTypes.SELECT,
//       raw: true,
//       replacements
//     }
//   );

//   return res.status(200).send({
//     message: 'Fetched completed transactions',
//     data: transactions
//   });
// };

export const fetchCompletedTransactions = async (req, res) => {
  const { startDate, endDate, category, adhyayanId, utsavId } = req.query;

  let dateFilter = '';
  let categoryFilter = '';
  let adhyayanFilter = '';
  let utsavFilter = '';
  let replacements = {
    status: ['completed', 'cash completed']
  };

  if (startDate && endDate) {
    dateFilter = 'AND DATE(t.createdAt) BETWEEN :startDate AND :endDate';
    replacements.startDate = startDate;
    replacements.endDate = endDate;
  }

  if (category && category !== 'all') {
    categoryFilter = 'AND t.category = :category';
    replacements.category = category;
  }

  // Filter for adhyayan category & adhyayanId
  if (category === 'adhyayan' && adhyayanId) {
    adhyayanFilter = 'AND sb.shibir_id = :adhyayanId';
    replacements.adhyayanId = adhyayanId;
  }

  // Filter for utsav category & utsavId
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
            WHEN t.category IN ('travel', 'utsav', 'adhyayan', 'food') THEN 1
            ELSE NULL
        END AS quantity,
        t.amount,
        t.discount,
        t.status,
        t.razorpay_order_id,
        COALESCE(cb.cardno, c.cardno) AS bookedBy_cardno,
        COALESCE(cb.issuedto, c.issuedto) AS bookedBy_issuedto,
        COALESCE(cb.address, c.address) AS bookedBy_address,
        COALESCE(cb.email, c.email) AS bookedBy_email,
        COALESCE(cb.mobno, c.mobno) AS bookedBy_mobno,
        c.cardno AS bookedFor_cardno,
        c.issuedto AS bookedFor_issuedto,
        c.address AS bookedFor_address,
        c.email AS bookedFor_email,
        c.mobno AS bookedFor_mobno
      FROM transactions t
      JOIN card_db c ON c.cardno = t.cardno
      LEFT JOIN shibir_booking_db sb ON t.bookingid = sb.bookingid AND t.category = 'adhyayan'
      LEFT JOIN room_booking rb ON t.bookingid = rb.bookingid AND t.category = 'room'
      LEFT JOIN travel_db tb ON t.bookingid = tb.bookingid AND t.category = 'travel'
      LEFT JOIN utsav_booking ub ON t.bookingid = ub.bookingid AND t.category = 'utsav'
      LEFT JOIN card_db cb ON cb.cardno = COALESCE(sb.bookedBy, rb.bookedBy, tb.bookedBy, ub.bookedBy)
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
    status: [
      STATUS_CASH_PENDING,
      STATUS_PAYMENT_PENDING
    ]
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
            WHEN t.category IN ('travel', 'utsav', 'adhyayan', 'food') THEN 1
            ELSE NULL
        END AS quantity,
        t.amount,
        t.discount,
        t.status,
        t.razorpay_order_id,
        COALESCE(cb.cardno, c.cardno) AS bookedBy_cardno,
        COALESCE(cb.issuedto, c.issuedto) AS bookedBy_issuedto,
        COALESCE(cb.address, c.address) AS bookedBy_address,
        COALESCE(cb.email, c.email) AS bookedBy_email,
        COALESCE(cb.mobno, c.mobno) AS bookedBy_mobno,
        c.cardno AS bookedFor_cardno,
        c.issuedto AS bookedFor_issuedto,
        c.address AS bookedFor_address,
        c.email AS bookedFor_email,
        c.mobno AS bookedFor_mobno
      FROM transactions t
      JOIN card_db c ON c.cardno = t.cardno
      LEFT JOIN shibir_booking_db sb ON t.bookingid = sb.bookingid AND t.category = 'adhyayan'
      LEFT JOIN room_booking rb ON t.bookingid = rb.bookingid AND t.category = 'room'
      LEFT JOIN travel_db tb ON t.bookingid = tb.bookingid AND t.category = 'travel'
      LEFT JOIN utsav_booking ub ON t.bookingid = ub.bookingid AND t.category = 'utsav'
      LEFT JOIN card_db cb ON cb.cardno = COALESCE(sb.bookedBy, rb.bookedBy, tb.bookedBy, ub.bookedBy)
      WHERE t.status IN ('pending')
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
    status: [
      STATUS_CREDITED
    ]
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
            WHEN t.category IN ('travel', 'utsav', 'adhyayan', 'food') THEN 1
            ELSE NULL
        END AS quantity,
        t.amount,
        t.discount,
        t.status,
        t.razorpay_order_id,
        COALESCE(cb.cardno, c.cardno) AS bookedBy_cardno,
        COALESCE(cb.issuedto, c.issuedto) AS bookedBy_issuedto,
        COALESCE(cb.address, c.address) AS bookedBy_address,
        COALESCE(cb.email, c.email) AS bookedBy_email,
        COALESCE(cb.mobno, c.mobno) AS bookedBy_mobno,
        c.cardno AS bookedFor_cardno,
        c.issuedto AS bookedFor_issuedto,
        c.address AS bookedFor_address,
        c.email AS bookedFor_email,
        c.mobno AS bookedFor_mobno
      FROM transactions t
      JOIN card_db c ON c.cardno = t.cardno
      LEFT JOIN shibir_booking_db sb ON t.bookingid = sb.bookingid AND t.category = 'adhyayan'
      LEFT JOIN room_booking rb ON t.bookingid = rb.bookingid AND t.category = 'room'
      LEFT JOIN travel_db tb ON t.bookingid = tb.bookingid AND t.category = 'travel'
      LEFT JOIN utsav_booking ub ON t.bookingid = ub.bookingid AND t.category = 'utsav'
      LEFT JOIN card_db cb ON cb.cardno = COALESCE(sb.bookedBy, rb.bookedBy, tb.bookedBy, ub.bookedBy)
      WHERE t.status IN ('credited')
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
export const uploadRazorpaySettlementExcel = async (req, res) => {
  try {
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheet = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: '' });

    const formattedRows = sheet.map(row => ({
      id: String(row.id),
      amount: parseFloat(row.amount),
      status: row.status,
      fees: parseFloat(row.fees),
      tax: parseFloat(row.tax),
      utr: row.utr,
      cerated_at: String(row.cerated_at)
    }));

    const incomingIds = formattedRows.map(row => row.id);

    const existingRecords = await RazorpaySettlement.findAll({
      where: { id: incomingIds },
      attributes: ['id'],
      raw: true
    });

    const existingIds = new Set(existingRecords.map(r => r.id));

    const uniqueRows = formattedRows.filter(row => !existingIds.has(row.id));

    if (uniqueRows.length === 0) {
      return res.status(200).json({ message: 'No new rows to insert. All IDs were duplicates.' });
    }

    await RazorpaySettlement.bulkCreate(uniqueRows);

    res.status(200).json({
      message: `${uniqueRows.length} new record(s) inserted. ${formattedRows.length - uniqueRows.length} duplicate(s) ignored.`
    });
  } catch (err) {
  console.error('Error processing Excel upload:', err);
  res.status(500).json({ error: 'Failed to process and store Excel data: ' + err.message });
}

};

// export const updateSettlementFieldsFromExcel = async (req, res) => {
//   try {
//     const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
//     const sheet = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: '' });

//     let updateCount = 0;
//     let skippedCount = 0;
//     let duplicateCount = 0;

//     for (const row of sheet) {
//       const paymentId = row.entity_id;
//       const settlementId = row['settlement_id'];

//       if (!paymentId) {
//         skippedCount++;
//         continue;
//       }

//       // ✅ Skip if settlement ID already exists
//       if (settlementId) {
//         const exists = await database.models.Transactions.findOne({
//           where: { razorpay_settlement_id: settlementId }
//         });

//         if (exists) {
//           duplicateCount++;
//           continue;
//         }
//       }

//       const [updated] = await database.models.Transactions.update(
//         {
//           razorpay_fee: parseFloat(row['fee (exclusive tax)']),
//           razorpay_tax: parseFloat(row['tax']),
//           razorpay_credit_amt: parseFloat(row['credit']),
//           payment_method: row['payment_method'],
//           razorpay_settlement_id: settlementId,
//           razorpay_settled_at: String(row['settled_at']),
//           settlement_utr: row['settlement_utr']
//         },
//         {
//           where: { razorpay_payment_id: paymentId }
//         }
//       );

//       updated ? updateCount++ : skippedCount++;
//     }

//     return res.status(200).json({
//       message: `${updateCount} updated, ${skippedCount} skipped (missing/unmatched payment IDs), ${duplicateCount} skipped (duplicate settlement IDs).`
//     });

//   } catch (err) {
//     console.error('Error updating settlements from Excel:', err);
//     res.status(500).json({ error: 'Failed to process and update Excel data: ' + err.message });
//   }
// };

function safeParseFloat(val) {
  if (val === null || val === undefined) return 0;
  if (typeof val === 'number') return val;
  // Remove commas, currency symbols etc.
  let cleaned = String(val).replace(/[^0-9.-]/g, '').trim();
  let num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

export const updateSettlementFieldsFromExcel = async (req, res) => {
  try {
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheet = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: '' });

    // Extract all settlement_ids to check duplicates
    const settlementIds = sheet
      .map(row => row['settlement_id'])
      .filter(id => id); // non-empty

    const existingSettlements = await database.models.Transactions.findAll({
      where: { razorpay_settlement_id: settlementIds },
      attributes: ['razorpay_settlement_id'],
      raw: true
    });
    const existingSettlementSet = new Set(existingSettlements.map(r => r.razorpay_settlement_id));

    let updateCount = 0;
    let skippedCount = 0;
    let duplicateCount = 0;

    const safeParseFloat = (val) => {
      if (val == null || val === '') return 0;
      const cleaned = String(val).replace(/[^0-9.-]/g, '').trim();
      const num = parseFloat(cleaned);
      return isNaN(num) ? 0 : num;
    };

    for (const row of sheet) {
      const paymentId = row['entity_id'];
      if (!paymentId) {
        skippedCount++;
        continue;
      }

      const settlementId = row['settlement_id'];
      if (settlementId && existingSettlementSet.has(settlementId)) {
        duplicateCount++;
        continue;
      }

      // Prepare update data, selecting only needed columns:
      const updateData = {
        amount: safeParseFloat(row['amount']),
        razorpay_fee: safeParseFloat(row['fee (exclusive tax)']),
        razorpay_tax: safeParseFloat(row['tax']),
        razorpay_credit_amt: safeParseFloat(row['credit']),
        payment_notes: row['payment_notes'] || null,
        order_id: row['order_id'] || null,
        razorpay_settlement_id: settlementId || null,
        razorpay_settled_at: row['settled_at'] ? new Date(row['settled_at']) : null,
        settlement_utr: row['settlement_utr'] || null,
        settled_by: row['settled_by'] || null
      };

      const [updated] = await database.models.RazorpaySettlementRecon.update(
        updateData,
        { where: { razorpay_payment_id: paymentId } }
      );

      updated ? updateCount++ : skippedCount++;
    }

    return res.status(200).json({
      message: `${updateCount} updated, ${skippedCount} skipped (missing/unmatched payment IDs), ${duplicateCount} skipped (duplicate settlement IDs).`
    });
  } catch (err) {
    console.error('Error updating settlements from Excel:', err);
    res.status(500).json({ error: 'Failed to process and update Excel data: ' + err.message });
  }
};

// GET /api/v1/settlements
// export const fetchAllSettlements = async (req, res) => {
//   try {
//     const settlements = await RazorpaySettlement.findAll();
//     res.status(200).json(settlements);
//   } catch (err) {
//     console.error('Error fetching settlements:', err); // Make sure this line exists
//     res.status(500).json({ error: 'Failed to fetch settlements' });
//   }
// };

import { Op } from 'sequelize';

export const fetchAllSettlements = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    const whereClause = {};
    if (startDate && endDate) {
      whereClause.cerated_at = {
        [Op.between]: [new Date(startDate), new Date(endDate)],
      };
    }

    const settlements = await RazorpaySettlement.findAll({
      where: whereClause,
      order: [['cerated_at', 'DESC']],
    });

    res.status(200).json(settlements);
  } catch (err) {
    console.error('Error fetching settlements:', err);
    res.status(500).json({ error: 'Failed to fetch settlements' });
  }
};

import { fn, col } from 'sequelize';

export const fetchTransactionsBySettlementId = async (req, res) => {
  const { settlementId } = req.params;

  try {
    const transactions = await Transactions.findAll({
      where: { razorpay_settlement_id: settlementId },
      attributes: [
        'razorpay_payment_id',
        [fn('SUM', col('amount')), 'totalAmount'],
        [fn('COUNT', col('razorpay_payment_id')), 'transactionCount']
      ],
      group: ['razorpay_payment_id']
    });

    return res.json({ data: transactions ?? [] });
  } catch (err) {
    console.error('Error fetching transactions:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};


export const fetchTransactionsByPaymentId = async (req, res) => {
  const { razorpay_payment_id } = req.params;

  try {
    const results = await database.query(
      `
      SELECT 
        t.bookingid,
        t.category,
        CASE 
          WHEN t.category = 'room' THEN rb.nights
          WHEN t.category IN ('travel', 'utsav', 'adhyayan') THEN 1
          ELSE NULL
        END AS quantity,
        t.amount,
        t.status,
        t.razorpay_order_id,
        t.razorpay_payment_id,
        COALESCE(cb.cardno, c.cardno) AS bookedBy_cardno,
        COALESCE(cb.issuedto, c.issuedto) AS bookedBy_issuedto,
        COALESCE(cb.address, c.address) AS bookedBy_address,
        COALESCE(cb.email, c.email) AS bookedBy_email,
        COALESCE(cb.mobno, c.mobno) AS bookedBy_mobno,
        c.cardno AS bookedFor_cardno,
        c.issuedto AS bookedFor_issuedto,
        c.address AS bookedFor_address,
        c.email AS bookedFor_email,
        c.mobno AS bookedFor_mobno
      FROM transactions t
      JOIN card_db c ON c.cardno = t.cardno
      LEFT JOIN shibir_booking_db sb ON t.bookingid = sb.bookingid AND t.category = 'adhyayan'
      LEFT JOIN room_booking rb ON t.bookingid = rb.bookingid AND t.category = 'room'
      LEFT JOIN travel_db tb ON t.bookingid = tb.bookingid AND t.category = 'travel'
      LEFT JOIN card_db cb ON cb.cardno = COALESCE(sb.bookedBy, rb.bookedBy, tb.bookedBy)
      WHERE t.status IN (:status)
        AND t.razorpay_payment_id = :razorpay_payment_id
      `,
      {
        type: QueryTypes.SELECT,
        raw: true,
        replacements: {
          status: ['completed'], // or STATUS_PAYMENT_COMPLETED
          razorpay_payment_id
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
