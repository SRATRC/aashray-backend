import { CardDb } from '../../models/associations.js';
import { STATUS_ACTIVE, STATUS_ONPREM } from '../../config/constants.js';
import Sequelize from 'sequelize';
import ApiError from '../../utils/ApiError.js';
import database from '../../config/database.js';

export const createCard = async (req, res) => {
  const {
    cardno,
    issuedto,
    gender,
    dob,
    mobno,
    email,
    idType,
    idNo,
    address,
    country,
    state,
    city,
    pin,
    centre,
    res_status
  } = req.body;

  const alreadyExists = await CardDb.findOne({
    where: { cardno: cardno, status: STATUS_ACTIVE }
  });

  if (alreadyExists) throw new ApiError(500, 'Card already exists');

  const user = await CardDb.create({
    cardno: cardno,
    issuedto: issuedto,
    gender: gender,
    dob: dob,
    mobno: mobno,
    email: email,
    idType: idType,
    idNo: idNo,
    address: address,
    country: country,
    state: state,
    city: city,
    pin: pin,
    centre: centre,
    status: STATUS_ONPREM,
    res_status: res_status,
    updatedBy: req.user.username
  });

  if (!user)
    throw new ApiError(500, 'Error occured while registering the card');

  return res
    .status(200)
    .send({ message: 'Successfully registered card', data: user.dataValues });
};

export const fetchAllCards = async (req, res) => {
  const page = parseInt(req.query.page) || req.body.page || 1;
  const pageSize = parseInt(req.query.page_size) || req.body.page_size || 10;
  const offset = (page - 1) * pageSize;

  const data = await CardDb.findAll({
    offset,
    limit: pageSize
  });

  return res.status(200).send({ message: 'Fetched all cards', data: data });
};

export const searchCardsByName = async (req, res) => {
  const page = parseInt(req.query.page) || req.body.page || 1;
  const pageSize = parseInt(req.query.page_size) || req.body.page_size || 10;
  const offset = (page - 1) * pageSize;

  const data = await CardDb.findAll({
    where: {
      issuedto: { [Sequelize.Op.like]: `%${req.params.name}%` }
    },
    offset,
    limit: pageSize
  });

  return res.status(200).send({ message: 'Fetched all cards', data: data });
};

export const updateCard = async (req, res) => {
  const {
    cardno,
    issuedto,
    gender,
    dob,
    mobno,
    email,
    idType,
    idNo,
    address,
    city,
    state,
    pin,
    centre,
    status,
    res_status
  } = req.body;

  const [itemsUpdated] = await CardDb.update(
    {
      issuedto: issuedto,
      gender: gender,
      dob: dob,
      mobno: mobno,
      email: email,
      idType: idType,
      idNo: idNo,
      address: address,
      city: city,
      state: state,
      pin: pin,
      centre: centre,
      status: status,
      res_status: res_status,
      updatedBy: req.user.username
    },
    {
      where: {
        cardno: cardno
      }
    }
  );

  if (itemsUpdated === 0) throw new ApiError(500, 'Error updating the card');

  return res.status(200).send({ message: 'Updated record' });
};

export const transferCard = async (req, res) => {
  const { cardno, new_cardno } = req.body;
  const [itemsUpdated, _data] = await CardDb.update(
    {
      cardno: new_cardno,
      updatedBy: req.user.username
    },
    {
      where: {
        cardno: cardno
      }
    }
  );
  if (itemsUpdated === 0) throw new ApiError(500, 'Error transfering the card');

  return res.status(200).send({ message: 'Card transferred successfully' });
};

// TODO: Add more balance endpoints if required
export const fetchTotalTransactions = async (req, res) => {
  const cardno = req.params.cardno;

  const [results, _] = await database.query(`SELECT 
  transaction_type,
  total_expense,
  total_refund,
  total_expense - total_refund AS net_amount
FROM (
  SELECT 
      'Room' AS transaction_type,
      COALESCE(SUM(CASE WHEN type = 'expense' AND status='payment pending' THEN amount ELSE 0 END), 0) AS total_expense,
      COALESCE(SUM(CASE WHEN type = 'refund' AND status='awaiting refund' THEN amount ELSE 0 END), 0) AS total_refund
  FROM 
      room_booking_transaction 
  WHERE 
      cardno = ${cardno}
  UNION ALL
  SELECT 
      'Travel' AS transaction_type,
      COALESCE(SUM(CASE WHEN type = 'expense' AND status='payment pending' THEN amount ELSE 0 END), 0) AS total_expense,
      COALESCE(SUM(CASE WHEN type = 'refund' AND status='awaiting refund' THEN amount ELSE 0 END), 0) AS total_refund
  FROM 
      travel_booking_transaction 
  WHERE 
      cardno = ${cardno}
  UNION ALL
  SELECT 
      'Guest Food' AS transaction_type,
      COALESCE(SUM(CASE WHEN type = 'expense' AND status='payment pending' THEN amount ELSE 0 END), 0) AS total_expense,
      COALESCE(SUM(CASE WHEN type = 'refund' AND status='awaiting refund' THEN amount ELSE 0 END), 0) AS total_refund
  FROM 
      guest_food_transaction 
  WHERE
      cardno = ${cardno}
) as t;`);

  return res
    .status(200)
    .send({ message: 'fetched all user transactions', data: results });
};
