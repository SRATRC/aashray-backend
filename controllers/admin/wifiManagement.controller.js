import XLSX from 'xlsx';
// import WifiPwd from '../../models/wifi.model.js'; // adjust path if needed
import {
  WifiDb,
  CardDb,
  FlatBooking,
  RoomBooking
} from '../../models/associations.js';
// import logger from '../../config/logger.js';
import database from '../../config/database.js';
import Sequelize from 'sequelize';
// import moment from 'moment';




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

    const uniqueRows = formattedRows.filter((row) => !existingPwd.has(row.password));

    if (uniqueRows.length === 0) {
      return res
        .status(200)
        .json({ message: 'No new rows to insert. All passwords were duplicates.' });
    }

    await WifiDb.bulkCreate(uniqueRows);

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
