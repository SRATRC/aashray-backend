# Adding a New Endpoint

Step-by-step guide for adding a new API endpoint to the Aashray backend.

## 1. Create or update the model

If your endpoint requires a new database table, create a model file:

**File:** `models/{table_name}.model.js`

```javascript
import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const MyModel = sequelize.define('my_model', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false
  },
  updatedBy: {
    type: DataTypes.STRING,
    defaultValue: 'USER'
  }
});

export default MyModel;
```

If relationships exist, add them to `models/associations.js`:

```javascript
import MyModel from './my_model.model.js';

CardDb.hasMany(MyModel, {
  foreignKey: 'cardno',
  sourceKey: 'cardno',
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE'
});

MyModel.belongsTo(CardDb, {
  foreignKey: 'cardno',
  targetKey: 'cardno'
});
```

Then export the model from `associations.js` in the export block at the bottom.

## 2. Create a migration

If you added or changed a model, create a migration:

```bash
npx sequelize migration:generate --name describe-the-change
```

Edit the generated file in `migrations/`:

```javascript
export default {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('my_model', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: Sequelize.STRING, allowNull: false },
      updatedBy: { type: Sequelize.STRING, defaultValue: 'USER' },
      createdAt: { type: Sequelize.DATE },
      updatedAt: { type: Sequelize.DATE }
    });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('my_model');
  }
};
```

## 3. Write the controller function

**File:** `controllers/client/{domain}.controller.js` or `controllers/admin/{domain}.controller.js`

```javascript
import { MyModel } from '../../models/associations.js';
import ApiError from '../../utils/ApiError.js';

export const fetchItems = async (req, res) => {
  const { cardno } = req.body;

  req.log.info('fetch_items_start', { cardno });

  const items = await MyModel.findAll({
    where: { cardno }
  });

  req.log.info('fetch_items_result', { count: items.length });

  res.status(200).json({
    message: 'Fetched results successfully',
    data: items
  });
};

export const createItem = async (req, res) => {
  const { cardno, name } = req.body;

  if (!name) throw new ApiError(400, 'Name is required');

  const item = await MyModel.create({
    cardno,
    name,
    updatedBy: 'USER'
  });

  req.log.info('item_created', { id: item.id, cardno });

  res.status(201).json({
    message: 'Created successfully',
    data: item
  });
};
```

No try/catch needed. `CatchAsync` handles errors at the route level. Use `req.log` for all logging -- it automatically carries `correlationId` and `userId`.

## 4. Create the route file

**File:** `routes/client/{domain}.routes.js` or `routes/admin/{domain}.routes.js`

For client routes:

```javascript
import { Router } from 'express';
import { validateCard } from '../../middleware/validate.js';
import { fetchItems, createItem } from '../../controllers/client/myDomain.controller.js';
import CatchAsync from '../../utils/CatchAsync.js';

const router = Router();
router.use(validateCard);

router.get('/items', CatchAsync(fetchItems));
router.post('/items', CatchAsync(createItem));

export default router;
```

For admin routes:

```javascript
import { Router } from 'express';
import { auth, authorizeRoles } from '../../middleware/AdminAuth.js';
import { ROLE_SUPER_ADMIN, ROLE_MY_ADMIN } from '../../config/constants.js';
import { fetchItems } from '../../controllers/admin/myDomain.controller.js';
import CatchAsync from '../../utils/CatchAsync.js';

const router = Router();
router.use(auth);
router.use(authorizeRoles(ROLE_SUPER_ADMIN, ROLE_MY_ADMIN));

router.get('/items', CatchAsync(fetchItems));

export default router;
```

## 5. Register the route in app.js

Import and mount the route:

```javascript
import myDomainRoutes from './routes/client/myDomain.routes.js';

// In the route mounting section:
app.use('/api/v1/mydomain', myDomainRoutes);
```

## 6. Add helper functions (if needed)

If the controller logic is reusable or complex, extract it to `helpers/{domain}.helper.js`:

```javascript
import logger from '../config/logger.js';

export async function validateMyItem(itemId, log = logger) {
  log.debug('validate_item', { itemId });
  const item = await MyModel.findByPk(itemId);
  if (!item) throw new ApiError(404, 'Item not found');
  return item;
}
```

Accept `log = logger` as the last parameter so the helper works from both HTTP requests (with `req.log` carrying correlation context) and from cron jobs (using the root logger).

## Checklist

- [ ] Model created in `models/` with correct field types and constraints
- [ ] Associations added in `models/associations.js` (if applicable)
- [ ] Model exported from `associations.js`
- [ ] Migration created and tested locally
- [ ] Controller function written (throws `ApiError` for validation, no try/catch)
- [ ] Route file created with correct middleware:
  - Client: `validateCard`
  - Admin: `auth` + `authorizeRoles(...)` with appropriate roles
- [ ] All controller functions wrapped in `CatchAsync()` at route level
- [ ] Route mounted in `app.js` with correct path prefix
- [ ] New constants added to `config/constants.js` (if any new statuses, types, error messages)
- [ ] Helper functions extracted for reusable logic
- [ ] Logging added:
  - Controllers use `req.log` (never import root `logger` in controllers)
  - Helpers accept `log = logger` as last parameter
  - Log messages use snake_case keys (e.g., `item_created`, not `"Item created"`)
  - Business events at `info`, internal steps at `debug`, recoverable issues at `warn`, failures at `error`
  - No passwords, tokens, OTPs, or raw model instances logged
- [ ] Tested manually with valid and invalid inputs
