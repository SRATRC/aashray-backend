import {
  RoomDb,
  RoomBooking
} from '../../models/associations.js';
import {
  ROOM_STATUS_AVAILABLE,
  TYPE_ROOM,
  ERR_BOOKING_NOT_FOUND,
  STATUS_CONFIRMED,
  STATUS_WAITING,
  STATUS_PAYMENT_PENDING,
  ROOM_STATUS_PENDING_CHECKIN
} from '../../config/constants.js';
import database from '../../config/database.js';
import Sequelize from 'sequelize';
import {
  validateDate
} from '../helper.js';
import ApiError from '../../utils/ApiError.js';
import sendMail from '../../utils/sendMail.js';
import getDates from '../../utils/getDates.js';
import { 
  userCancelBooking 
} from '../../helpers/transactions.helper.js';

// TODO: DEPRECATE THIS ENDPOINT
export const AvailabilityCalender = async (req, res) => {
  const startDate = new Date(req.body.checkin_date);
  const endDate = new Date(req.body.checkout_date);
  if (startDate != endDate) endDate.setDate(endDate.getDate() - 1);

  validateDate(req.body.checkin_date, req.body.checkout_date);

  const allDates = getDates(startDate, endDate);

  const gender = req.body.gender || req.user.gender;
  const total_beds = await RoomDb.count({
    where: {
      roomtype: req.body.room_type,
      gender: req.body.floor_pref + gender,
      roomstatus: ROOM_STATUS_AVAILABLE
    }
  });

  var beds_occupied = [];
  for (const i of allDates) {
    const res = await RoomBooking.findAll({
      attributes: [
        [
          Sequelize.fn(
            'SUM',
            Sequelize.literal(`CASE WHEN roomtype = 'nac' THEN 1 ELSE 0 END`)
          ),
          'nac'
        ],
        [
          Sequelize.fn(
            'SUM',
            Sequelize.literal(`CASE WHEN roomtype = 'ac' THEN 1 ELSE 0 END`)
          ),
          'ac'
        ]
      ],
      where: {
        checkin: { [Sequelize.Op.lte]: i },
        checkout: { [Sequelize.Op.gt]: i },
        status: {
          [Sequelize.Op.in]: ['pending checkin', 'checkedin', 'checkedout']
        },
        gender: gender
      },
      group: 'checkin'
    });
    beds_occupied.push({
      dtbooked: i,
      count: res[0]
    });
  }
  return res.status(200).send({
    message: 'fetched availiblity calender',
    data: { total_beds: total_beds, beds_occupied: beds_occupied }
  });
};

export const ViewAllBookings = async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.page_size) || 10;
  const offset = (page - 1) * pageSize;

  const user_bookings = await database.query(
    `SELECT 
    t1.bookingid, 
    COALESCE(t1.guest, 'NA') AS bookedFor,
    t3.name AS name,
    t1.roomno, 
    t1.checkin, 
    t1.checkout, 
    t1.nights, 
    t1.roomtype, 
    t1.status, 
    t1.gender, 
    COALESCE(t2.amount, 0) AS amount, 
    t2.status AS transaction_status
FROM room_booking t1
LEFT JOIN transactions t2 
    ON t1.bookingid = t2.bookingid AND t2.category = :category
LEFT JOIN guest_db t3 ON t3.id = t1.guest
WHERE t1.cardno = :cardno

ORDER BY checkin DESC
LIMIT :limit OFFSET :offset;
`,
    {
      replacements: {
        cardno: req.user.cardno,
        category: TYPE_ROOM,
        limit: pageSize,
        offset: offset
      },
      type: Sequelize.QueryTypes.SELECT
    }
  );
  return res.status(200).send(user_bookings);
};

export const CancelBooking = async (req, res) => {
  const { bookingid, bookedFor } = req.body;

  const t = await database.transaction();
  req.transaction = t;

  const booking = await RoomBooking.findOne({
    where: {
      bookingid: bookingid,
      cardno: req.user.cardno,
      guest: bookedFor == undefined ? null : bookedFor,
      status: [
        STATUS_CONFIRMED,
        STATUS_WAITING,
        STATUS_PAYMENT_PENDING,
        ROOM_STATUS_PENDING_CHECKIN
      ]
    }
  });

  if (!booking) {
    throw new ApiError(404, ERR_BOOKING_NOT_FOUND);
  }

  await userCancelBooking(req.user, booking, t);
  await t.commit();

  sendMail({
    email: req.user.email,
    subject: `Your Raj Sharan Booking at SRATRC has been canceled.`,
    template: 'rajSharanCancellation',
    context: {
      name: req.user.issuedto,
      bookingid: booking.bookingid,
      checkin: booking.checkin,
      checkout: booking.checkout
    }
  });

  res.status(200).send({ message: 'Room booking canceled' });
};