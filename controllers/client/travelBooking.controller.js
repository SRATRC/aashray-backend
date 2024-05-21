import {
  TravelDb,
  TravelBookingTransaction
} from '../../models/associations.js';
import database from '../../config/database.js';
import Sequelize from 'sequelize';
import SendMail from '../../utils/sendMail.js';
import {
  STATUS_CONFIRMED,
  STATUS_WAITING,
  TRAVEL_PRICE,
  STATUS_CANCELLED,
  STATUS_PAYMENT_PENDING,
  STATUS_PAYMENT_COMPLETED,
  TYPE_EXPENSE
} from '../../config/constants.js';
import moment from 'moment';
import { v4 as uuidv4 } from 'uuid';
import ApiError from '../../utils/ApiError.js';

export const BookTravel = async (req, res) => {
  const t = await database.transaction();
  req.transaction = t;

  const today = moment().format('YYYY-MM-DD');
  if (req.body.date < today) {
    throw new ApiError(400, 'Invalid Date');
  }

  const isBooked = await TravelDb.findOne({
    where: {
      cardno: req.body.cardno,
      status: { [Sequelize.Op.in]: [STATUS_CONFIRMED, STATUS_WAITING] },
      date: req.body.date
    }
  });
  if (isBooked) {
    throw new ApiError(400, 'Already booked on the selected date');
  }

  const booking = await TravelDb.create(
    {
      cardno: req.user.cardno,
      date: req.body.date,
      pickup_point: req.body.pickup_point,
      drop_point: req.body.drop_point,
      luggage: req.body.luggage,
      comments: req.body.comments,
      bookingid: uuidv4()
    },
    { transaction: t }
  );

  const bookingTransaction = await TravelBookingTransaction.create(
    {
      cardno: req.user.cardno,
      bookingid: booking.dataValues.bookingid,
      type: TYPE_EXPENSE,
      amount: TRAVEL_PRICE,
      status: STATUS_PAYMENT_PENDING
    },
    { transaction: t }
  );

  if (booking == undefined || bookingTransaction == undefined) {
    throw new ApiError(500, 'Failed to book travel');
  }

  const message = `Dear Mumukshu,<br><br>

    Jai Sadguru Dev Vandan! We have received your travel booking request from ${req.body.pickup_point} to ${req.body.drop_point} as per following details:<br><br>
    
    Booking id: ${booking.dataValues.bookingid}<br>
    Travel Date: ${req.body.date}<br>
    Pick-up location: ${req.body.pickup_point}<br>
    Drop-off location: ${req.body.drop_point}<br><br>
    
    Standard pickup location and timings from Mumbai to Research Centre:<br><br>
    1) Dadar Swaminarayan Temple - 8:00 am<br>
    2) Amar Mahal - Chembur / Ghatkopar - 8:20 am<br>
    3) Mulund - Airoli Junction - 8:40 am<br><br>

    Standard pickup location and timing from Research Centre to Mumbai:<br><br>
    Reception Area at 1:00 pm<br><br>

    We will review your travel request and update the status on the portal. <br><br>
    
    Request you to please read the Raj Pravas guidelines carefully (link below):<br><br>

    <a href = 'https://drive.google.com/file/d/1kodGs34F8W3m8GHfm3bMzROaUGNoIVav/view?usp=sharing'>Click here for guidelines</a><br><br>
    
    You can view the status of your request under view/cancel my booking by <a href='http://datachef.in/sratrc/rajpravas/cancel_via_phone.php'>Clicking here</a><br><br>

    Once your travel booking status is <b>Approved, pending payment confirmation</b> please pay the amount shown in the screen under view / cancel my booking using the UPI id <b>sratrc@ibl</b>. 
    You can copy & paste the UPI ID link (sratrc@ibl) in Google Pay, Amazon Pay, Paytm, PhonePay, FreeCharge, MobiKwik etc to make payment<br><br>
    
    Post payment, please share screenshot of the payment along with your booking id to Raj Pravas Team.  <br><br>

    Once your travel is confirmed, you can coordinate with Sandeep Driver on +919769975704 only on the date of your travel <br><br>
    
    Regards,<br>
    Raj Pravas Admin, <br>
    Virag Shah (9769644960)<br>
    Siddhi Shah (9831632801)<br>`;

  SendMail({
    email: req.user.email,
    subject: `Your Booking for RajPravas`,
    message
  });

  await t.commit();

  return res.status(200).send({ message: 'travel booked' });
};

export const FetchUpcoming = async (req, res) => {
  const today = moment().format('YYYY-MM-DD');
  const upcoming = await TravelDb.findAll({
    where: {
      cardno: req.params.cardno,
      date: { [Sequelize.Op.gt]: today }
    }
  });
  return res.status(200).send({ message: 'Fetched data', data: upcoming });
};

export const CancelTravel = async (req, res) => {
  const t = await database.transaction();
  req.transaction = t;

  await TravelDb.update(
    {
      status: STATUS_CANCELLED
    },
    {
      where: {
        cardno: req.body.cardno,
        bookingid: req.body.bookingid
      },
      transaction: t
    }
  );

  const travelBookingTransaction = await TravelBookingTransaction.findOne({
    where: {
      cardno: req.user.cardno,
      bookingid: req.body.bookingid,
      type: TYPE_EXPENSE,
      status: {
        [Sequelize.Op.in]: [STATUS_PAYMENT_PENDING, STATUS_PAYMENT_COMPLETED]
      }
    }
  });

  if (travelBookingTransaction.status == STATUS_PAYMENT_PENDING) {
    travelBookingTransaction.status = STATUS_CANCELLED;
    await travelBookingTransaction.save({ transaction: t });
  } else if (travelBookingTransaction.status == STATUS_PAYMENT_PENDING) {
    travelBookingTransaction.status = STATUS_AWAITING_REFUND;
    await travelBookingTransaction.save({ transaction: t });
  }

  await t.commit();

  return res.status(200).send({ message: 'Successfully cancelled booking' });
};

export const ViewAllTravel = async (req, res) => {
  const data = await TravelDb.findAll({
    where: {
      cardno: req.params.cardno
    },
    order: [['date', 'ASC']]
  });
  return res.status(200).send({ message: 'Fetched data', data: data });
};
