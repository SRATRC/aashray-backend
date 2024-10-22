import { Sequelize } from 'sequelize';

const mockSequelize = {
  define: jest.fn().mockReturnValue({
    belongsTo: jest.fn(),
    hasMany: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
  }),
  DataTypes: Sequelize.DataTypes,
  Op: Sequelize.Op,
  authenticate: jest.fn(),
  sync: jest.fn(),
};

export default mockSequelize;
