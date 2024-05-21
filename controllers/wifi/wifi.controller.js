import { RoomBooking, WifiDb } from '../../models/associations.js';
import SendMail from '../../utils/sendMail.js';
import {
  ROOM_STATUS_CHECKEDIN,
  STATUS_ACTIVE,
  STATUS_INACTIVE
} from '../../config/constants.js';
import ApiError from '../../utils/ApiError.js';

export const generatePassword = async (req, res) => {
  const isCheckedin = await RoomBooking.findOne({
    where: {
      cardno: req.user.cardno,
      status: ROOM_STATUS_CHECKEDIN
    }
  });
  if (!isCheckedin) {
    throw new ApiError(401, 'User not checkedin');
  }

  const count = await WifiDb.count({
    where: { cardno: req.user.cardno, status: STATUS_INACTIVE }
  });
  if (count < 4) {
    const [updatedRows, updatedRowsCount] = await WifiDb.update(
      {
        status: STATUS_INACTIVE,
        bookingid: isCheckedin.bookingid,
        cardno: req.user.cardno
      },
      {
        where: { status: STATUS_ACTIVE },
        order: [['pwd_id', 'ASC']],
        limit: 1,
        returning: true
      }
    );
    const updatedRow = await WifiDb.findOne({
      where: { status: STATUS_INACTIVE },
      order: [['pwd_id', 'DESC']],
      limit: 1
    });
    if (updatedRowsCount === 0) {
      throw new ApiError(404, 'Error updating the status');
    }

    const message = `Dear ${req.user.issuedto},<br><br>

      Your Access code for WiFi at Ashram for the duration of your stay is: ${updatedRow.password}<br><br>

      Please note that you can use this wifi code on one device only. The code is valid for 15 days. 
      
      For more details on how to connect and use WiFi, please watch <a href='https://rebrand.ly/SRATRCvisitorsWiFi' target='_blank'>THIS VIDEO</a><br><br>

      For any issues with wifi connectivity, kindly contact Research Centre Office.<br><br>

      Research Centre Admin office, <br>
      7875432613 / 9004273512`;

    await SendMail({
      email: req.user.email,
      subject: `Your wifi password: ${updatedRow.password}`,
      message
    });

    return res.status(200).send({
      data: updatedRow,
      message: 'Your wifi password has been generated'
    });
  } else {
    throw new ApiError(400, 'Cannot generate more than 3 passwords');
  }
};

export const getPassword = async (req, res) => {
  const passwords = await WifiDb.findAll({
    where: { cardno: req.params.cardno },
    order: [['transaction_log', 'ASC']]
  });
  return res.status(200).send({ data: passwords, message: 'Passwords found' });
};
