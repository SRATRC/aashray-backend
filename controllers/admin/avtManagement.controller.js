import { CardDb } from '../../models/associations.js';
import Sequelize from 'sequelize';

export const fetchAllCards = async (req, res) => {
  
  const data = await CardDb.findAll({
  });

  return res.status(200).send({ message: 'Fetched all cards', data: data });
};

export const searchCards = async (req, res) => {
  
  const data = await CardDb.findAll({
    where: {
      issuedto: { [Sequelize.Op.like]: `%${req.params.name}%` }
    },
  });

  return res.status(200).send({ message: 'Fetched all cards', data: data });
};

