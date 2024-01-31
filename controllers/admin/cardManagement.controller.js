import { CardDb } from '../../models/associations.js';
import { STATUS_ONPREM } from '../../config/constants.js';
import Sequelize from 'sequelize';
import ApiError from '../../utils/ApiError.js';

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
    city,
    state,
    pin,
    centre,
    res_status
  } = req.body;

  const alreadyExists = await CardDb.findOne({
    where: { cardno: cardno }
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
    city: city,
    state: state,
    pin: pin,
    centre: centre,
    status: STATUS_ONPREM,
    res_status: res_status
  });

  if (!user)
    throw new ApiError(500, 'Error occured while registering the card');

  return res
    .status(200)
    .send({ message: 'Successfully registered card', data: user.dataValues });
};

export const fetchAllCards = async (req, res) => {
  const page = req.body.page || 1;
  const pageSize = req.body.page_size || 10;
  const offset = (page - 1) * pageSize;

  const data = await CardDb.findAll({
    offset,
    limit: pageSize
  });

  return res.status(200).send({ message: 'Fetched all cards', data: data });
};

export const searchCards = async (req, res) => {
  const page = req.body.page || 1;
  const pageSize = req.body.page_size || 10;
  const offset = (page - 1) * pageSize;

  const data = await CardDb.findAll({
    where: {
      cardno: { [Sequelize.Op.like]: `%${req.params.cardno}%` }
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
      res_status: res_status
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
      cardno: new_cardno
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

// TODO: Add balance endpoints
