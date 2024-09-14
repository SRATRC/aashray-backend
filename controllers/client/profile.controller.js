import { CardDb } from '../../models/associations.js';
import Transactions from '../../models/transactions.model.js';
import ApiError from '../../utils/ApiError.js';

export const updateProfile = async (req, res) => {
  const {
    issuedto,
    gender,
    dob,
    address,
    mobno,
    email,
    country,
    state,
    city,
    pin,
    centre
  } = req.body;
  const updatedProfile = await CardDb.update(
    {
      issuedto,
      gender,
      dob,
      address,
      mobno,
      email,
      country,
      state,
      city,
      pin,
      centre
    },
    {
      where: {
        cardno: req.user.cardno
      }
    }
  );
  if (!updatedProfile) {
    throw new ApiError(404, 'user not updated');
  }

  const updatedProfileData = await CardDb.findOne({
    where: {
      cardno: req.user.cardno
    },
    attributes: {
      exclude: ['id', 'createdAt', 'updatedAt', 'updatedBy']
    }
  });

  return res
    .status(200)
    .send({ message: 'Profile Updated', data: updatedProfileData });
};

export const transactions = async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.page_size) || 10;
  const offset = (page - 1) * pageSize;

  const transactions = await Transactions.findAll({
    where: {
      cardno: req.user.cardno
    },
    attributes: {
      exclude: ['id', 'cardno', 'updatedAt', 'updatedBy']
    },
    order: [['createdAt', 'DESC']],
    offset,
    limit: pageSize
  });
  return res
    .status(200)
    .send({ message: 'fetched transactions', data: transactions });
};
