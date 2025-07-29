'use strict';

import { fileURLToPath } from 'url';
import fs from 'fs';
import path from 'path';
import Sequelize from 'sequelize';
import sequelize from '../config/database.js';

const __filename = fileURLToPath(import.meta.url);
const basename = path.basename(__filename);
const db = {};

fs.readdirSync(path.dirname(__filename))
  .filter(
    (file) =>
      file.indexOf('.') !== 0 &&
      file !== basename &&
      file.slice(-3) === '.js' &&
      file.indexOf('.test.js') === -1
  )
  .forEach(async (file) => {
    const modelModule = await import(path.join(path.dirname(__filename), file));
    const model = modelModule.default(sequelize, Sequelize.DataTypes);
    db[model.name] = model;
  });

Object.keys(db).forEach((modelName) => {
  if (db[modelName].associate) {
    db[modelName].associate(db);
  }
});

db.sequelize = sequelize;
db.Sequelize = Sequelize;

export default db;
