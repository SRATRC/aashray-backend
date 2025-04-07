import {
  STATUS_PAYMENT_COMPLETED,
  STATUS_CASH_COMPLETED
} from '../../config/constants.js';
import { QueryTypes } from 'sequelize';
import database from '../../config/database.js';

export const fetchCompletedTransactions = async (req, res) => {
  const transactions = await database.query(
    `
        SELECT
    c.cardno,
    c.issuedto,
    c.address,
    c.email,
    c.mobno,
    t.bookingid,
    t.amount,
    t.category,
    t.status,
    COALESCE(cb.issuedto, NULL) AS bookedBy
FROM
    card_db c
JOIN
    transactions t ON c.cardno = t.cardno
LEFT JOIN
    shibir_booking_db sb ON t.bookingid = sb.bookingid AND t.category = 'adhyayan'
LEFT JOIN
    room_booking rb ON t.bookingid = rb.bookingid AND t.category = 'room'
LEFT JOIN
    travel_db tb ON t.bookingid = tb.bookingid AND t.category = 'travel'
LEFT JOIN
    card_db cb ON cb.cardno = COALESCE(sb.bookedBy, rb.bookedBy, tb.bookedBy)
WHERE
    t.status IN (:status);
        `,
    {
      type: QueryTypes.SELECT,
      raw: true,
      replacements: {
        status: [STATUS_PAYMENT_COMPLETED, STATUS_CASH_COMPLETED]
      }
    }
  );

  return res.status(200).send({
    message: 'Fetched completed transactions',
    data: transactions
  });
};
