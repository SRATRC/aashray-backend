import { CardDb } from '../../models/associations.js';
import Sequelize from 'sequelize';

export const fetchAllCards = async (req, res) => {
  
  // The push address stays in the backend; staff screens never use it.
  const data = await CardDb.findAll({
    attributes: { exclude: ['token'] }
  });

  return res.status(200).send({ message: 'Fetched all cards', data: data });
};

export const searchCards = async (req, res) => {
  
  const data = await CardDb.findAll({
    where: {
      issuedto: { [Sequelize.Op.like]: `%${req.params.name}%` }
    },
    attributes: { exclude: ['token'] }
  });

  return res.status(200).send({ message: 'Fetched all cards', data: data });
};

