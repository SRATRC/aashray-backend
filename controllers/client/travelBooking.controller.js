import { TravelDb } from '../../models/associations.js';
import database from '../../config/database.js';
import Sequelize from 'sequelize';
import {
  STATUS_CONFIRMED,
  STATUS_WAITING,
  MSG_CANCEL_SUCCESSFUL
} from '../../config/constants.js';
import moment from 'moment';
import ApiError from '../../utils/ApiError.js';
import { userCancelBooking } from '../../helpers/transactions.helper.js';

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
  const { bookingid } = req.body;

  const t = await database.transaction();
  req.transaction = t;

  const booking = await TravelDb.findOne({
    where: {
      cardno: req.user.cardno,
      bookingid: bookingid,
      status: [
        STATUS_WAITING,
        STATUS_CONFIRMED
      ]
    }
  });

  if (!booking) {
    throw new ApiError(404, ERR_BOOKING_NOT_FOUND);
  }

  await userCancelBooking(req.user, booking, t);
  await t.commit();

  // TODO: Send email
  // sendMail({
  //   email: req.user.email,
  //   subject: 'Your Raj Pravas (Travel) booking has been canceled',
  //   template: 'rajPravasCancellation',
  //   context: {
  //     name: req.user.issuedto,
  //     adhyayanName: adhyayan.dataValues.name
  //   }
  // });

  return res.status(200).send({ message: MSG_CANCEL_SUCCESSFUL });
};

export const ViewAllTravel = async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.page_size) || 10;
  const offset = (page - 1) * pageSize;

  // TODO: include guest information
  const data = await database.query(
    `SELECT 
      t1.bookingid, 
      t1.date, 
      t1.pickup_point, 
      t1.drop_point, 
      t1.type, 
      t1.luggage, 
      t1.comments, 
      t1.status, 
      t2.amount, 
      t2.status as transaction_status
   FROM travel_db t1
   LEFT JOIN transactions t2 ON t1.bookingid = t2.bookingid
   WHERE t1.cardno = :cardno
   ORDER BY t1.date DESC
   LIMIT :limit OFFSET :offset`,
    {
      replacements: {
        cardno: req.user.cardno,
        limit: pageSize,
        offset: offset
      },
      type: Sequelize.QueryTypes.SELECT
    }
  );

  return res.status(200).send({ message: 'Fetched data', data: data });
};
