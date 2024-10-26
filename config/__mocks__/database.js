import { query } from 'express';
import { Sequelize } from 'sequelize';

const mockSequelize = {
  define: function(modelName, properties, options) {
    return jest.fn().mockReturnValue({
      modelName: modelName,
      belongsTo: jest.fn(),
      hasMany: jest.fn(),
      findAll: jest.fn(),
      findOne: jest.fn(),
    });
  },
  DataTypes: Sequelize.DataTypes,
  Op: Sequelize.Op,
  authenticate: jest.fn(),
  sync: jest.fn(),
  query: jest.fn(),
  transaction: jest.fn(),
};

export default mockSequelize;
