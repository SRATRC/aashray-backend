import { CardDb } from '../../models/associations.js';
import { ERR_CARD_NOT_FOUND, MSG_UPDATE_SUCCESSFUL, STATUS_ACTIVE, STATUS_OFFPREM } from '../../config/constants.js';
import Sequelize from 'sequelize';
import ApiError from '../../utils/ApiError.js';
import database from '../../config/database.js';

//FIXME: Add validations and throw informative error messages
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
    where: { cardno: cardno }
  });

  if (alreadyExists) {
    throw new ApiError(400, 'Card already exists');
  }

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
    center: centre,
    status: STATUS_OFFPREM,
    res_status: res_status,
    updatedBy: req.user.username
  });

  if (!user)
    throw new ApiError(500, 'Error occured while registering the card');

  return res
    .status(200)
    .send({ message: 'Successfully registered card', data: user });
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

  const card = await CardDb.findOne({
    where: { cardno: cardno }
  });

  if (!card) {
    throw new ApiError(400, ERR_CARD_NOT_FOUND);
  }

  await card.update(
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
      center: centre,
      status: status,
      res_status: res_status,
      updatedBy: req.user.username
    }
  );

  return res.status(200).send({ message: MSG_UPDATE_SUCCESSFUL });
};

export const transferCard = async (req, res) => {
  const { cardno, new_cardno } = req.body;

  const card = await CardDb.findOne({
    where: { cardno: cardno }
  });

  if (!card) {
    throw new ApiError(400, ERR_CARD_NOT_FOUND);
  }

  await card.update(
    {
      cardno: new_cardno,
      updatedBy: req.user.username
    }
  );

  return res.status(200).send({ message: MSG_UPDATE_SUCCESSFUL });
};

// TODO: FIX this
export const fetchTotalTransactions = async (req, res) => {
  const cardno = req.params.cardno;

  const [results, _] = await database.query(
    `SELECT 
      category,
      total_expense,
      total_refund,
      total_expense - total_refund AS net_amount
    FROM (
      SELECT 
          category,
          SUM(CASE WHEN status='pending' THEN amount ELSE 0 END) AS total_expense,
          SUM(CASE WHEN status='credited' THEN amount ELSE 0 END) AS total_refund
      FROM 
          transactions 
      WHERE 
          cardno = ${cardno}
      GROUP BY 
          category) as t;`);

  return res
    .status(200)
    .send({ message: 'fetched all user transactions', data: results });
};
