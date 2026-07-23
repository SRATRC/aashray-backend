import {
  GateRecord,
  CardDb,
  FlatBooking,
  RoomBooking
} from '../../models/associations.js';
import {
  STATUS_MUMUKSHU,
  STATUS_GUEST,
  STATUS_ONPREM,
  STATUS_RESIDENT,
  STATUS_SEVA_KUTIR,
  STATUS_OFFPREM,
  ROOM_STATUS_CHECKEDIN,
  ROOM_STATUS_CHECKEDOUT,
  ROOM_STATUS_PENDING_CHECKIN
} from '../../config/constants.js';
import logger from '../../config/logger.js';
import database from '../../config/database.js';
import ApiError from '../../utils/ApiError.js';
import Sequelize from 'sequelize';
import moment from 'moment';

export const fetchTotal = async (req, res) => {
  const result = await CardDb.findAll({
    attributes: [
      'res_status',
      [Sequelize.fn('COUNT', Sequelize.literal('*')), 'count']
    ],
    where: { status: STATUS_ONPREM },
    group: ['res_status']
  });

  return res.status(200).send({ message: 'Success', data: result });
};

export const fetchPR = async (req, res) => {
  const total_pr = await CardDb.findAll({
    where: {
      status: STATUS_ONPREM,
      res_status: STATUS_RESIDENT
    },
    attributes: {
      include: [
        // Subquery: Last check-in (status = ONPREM)
        [
          Sequelize.literal(`(
            SELECT MAX(createdAt)
            FROM gate_record AS gr
            WHERE gr.cardno = CardDb.cardno AND gr.status = '${STATUS_ONPREM}'
          )`),
          'last_checkin'
        ],
        // Subquery: Last check-out (status = OFFPREM)
        [
          Sequelize.literal(`(
            SELECT MAX(createdAt)
            FROM gate_record AS gr
            WHERE gr.cardno = CardDb.cardno AND gr.status = '${STATUS_OFFPREM}'
          )`),
          'last_checkout'
        ]
      ]
    }
  });

  return res.status(200).send({ message: 'Success', data: total_pr });
};

export const fetchGuest = async (req, res) => {
  const total_guest = await CardDb.findAll({
    where: {
      status: STATUS_ONPREM,
      res_status: STATUS_GUEST
    },
    attributes: {
      include: [
        // Last check-in time
        [
          Sequelize.literal(`(
            SELECT MAX(createdAt)
            FROM gate_record AS gr
            WHERE gr.cardno = CardDb.cardno AND gr.status = '${STATUS_ONPREM}'
          )`),
          'last_checkin'
        ],
        // Last check-out time
        [
          Sequelize.literal(`(
            SELECT MAX(createdAt)
            FROM gate_record AS gr
            WHERE gr.cardno = CardDb.cardno AND gr.status = '${STATUS_OFFPREM}'
          )`),
          'last_checkout'
        ]
      ]
    }
  });

  return res.status(200).send({ message: 'Success', data: total_guest });
};

export const fetchMumukshu = async (req, res) => {
  const total_mumukshu = await CardDb.findAll({
    where: {
      status: STATUS_ONPREM,
      res_status: STATUS_MUMUKSHU
    },
    attributes: {
      include: [
        // Last check-in time
        [
          Sequelize.literal(`(
            SELECT MAX(createdAt)
            FROM gate_record AS gr
            WHERE gr.cardno = CardDb.cardno AND gr.status = '${STATUS_ONPREM}'
          )`),
          'last_checkin'
        ],
        // Last check-out time
        [
          Sequelize.literal(`(
            SELECT MAX(createdAt)
            FROM gate_record AS gr
            WHERE gr.cardno = CardDb.cardno AND gr.status = '${STATUS_OFFPREM}'
          )`),
          'last_checkout'
        ]
      ]
    }
  });

  return res.status(200).send({ message: 'Success', data: total_mumukshu });
};

export const fetchSevaKutir = async (req, res) => {
  const total_seva = await CardDb.findAll({
    where: {
      status: STATUS_ONPREM,
      res_status: STATUS_SEVA_KUTIR
    },
    attributes: {
      include: [
        // Last check-in time (latest ONPREM entry)
        [
          Sequelize.literal(`(
            SELECT MAX(createdAt)
            FROM gate_record AS gr
            WHERE gr.cardno = CardDb.cardno AND gr.status = '${STATUS_ONPREM}'
          )`),
          'last_checkin'
        ],
        // Last check-out time (latest OFFPREM entry)
        [
          Sequelize.literal(`(
            SELECT MAX(createdAt)
            FROM gate_record AS gr
            WHERE gr.cardno = CardDb.cardno AND gr.status = '${STATUS_OFFPREM}'
          )`),
          'last_checkout'
        ]
      ]
    }
  });

  return res.status(200).send({ message: 'Success', data: total_seva });
};

export const gateEntry = async (req, res) => {
  const t = await database.transaction();
  req.transaction = t;

  const { cardno } = req.body;

  const user = await CardDb.findOne({
    where: { cardno }
  });

  if (!user) {
    throw new ApiError(404, 'User not found');
  }

  if (user.status == STATUS_OFFPREM)
    await user.update(
      { status: STATUS_ONPREM, updatedBy: req.user.username },
      { transaction: t }
    );

  await GateRecord.create(
    {
      cardno,
      status: STATUS_ONPREM,
      updatedBy: req.user.username
    },
    { transaction: t }
  );

  await t.commit();
  return res.status(200).send({
    message: 'Success',
    cardno: user.cardno,
    issuedto: user.issuedto
  });
};

export const gateExit = async (req, res) => {
  const t = await database.transaction();
  req.transaction = t;

  const user = await CardDb.findOne({
    where: { cardno: req.body.cardno }
  });

  user.update(
    { status: STATUS_OFFPREM, updatedBy: req.user.username },
    { transaction: t }
  );

  await GateRecord.create(
    {
      cardno: req.body.cardno,
      status: STATUS_OFFPREM,
      updatedBy: req.user.username
    },
    { transaction: t }
  );

  const today = moment().format('YYYY-MM-DD');

  const booking = await FlatBooking.findOne({
    where: {
      cardno: req.body.cardno,
      status: ROOM_STATUS_CHECKEDIN,
      checkout: { [Sequelize.Op.lte]: today }
    }
  });

  if (booking) {
    booking.status = ROOM_STATUS_CHECKEDOUT;
    await booking.save({ transaction: t });
  }

  await t.commit();

  return res.status(200).send({
    message: 'Success',
    cardno: user.cardno,
    issuedto: user.issuedto
  });
};

export const gateRecord = async (req, res) => {
  const result = await database.query(
    `
  SELECT 
  gr.*, 
  cd.issuedto, 
  cd.mobno
FROM 
  gate_record AS gr
LEFT JOIN 
  card_db AS cd 
ON 
  gr.cardno = cd.cardno
ORDER BY 
  gr.createdAt DESC;
`,
    {
      type: Sequelize.QueryTypes.SELECT
    }
  );

  return res.status(200).send({ message: 'Success', data: result });
};

export const fetchGateHistoryByCard = async (req, res) => {
  const { cardno } = req.params;

  const history = await GateRecord.findAll({
    where: { cardno },
    order: [['createdAt', 'DESC']]
  });

  return res.status(200).send({
    message: 'Fetched gate history',
    data: history
  });
};
