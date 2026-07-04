# Database Migrations

## Overview

Migrations are managed by [Sequelize CLI](https://github.com/sequelize/cli). Migration files live in the `migrations/` directory and follow a timestamp naming convention: `YYYYMMDDHHMMSS-description.js`.

The Sequelize CLI reads database credentials from `config/config.js` (not `config/database.js` which is used by the application at runtime).

## Creating a Migration

Generate a new migration file:

```bash
npx sequelize migration:generate --name add-column-to-table
```

This creates a file like `migrations/20260330120000-add-column-to-table.js`. Edit the `up` and `down` methods:

```javascript
export default {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('table_name', 'new_column', {
      type: Sequelize.STRING,
      allowNull: true,
      defaultValue: null
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('table_name', 'new_column');
  }
};
```

## Running Migrations

Run all pending migrations:

```bash
# Development
NODE_ENV=dev npx sequelize db:migrate

# QA
NODE_ENV=qa npx sequelize db:migrate

# Production (used in CI/CD)
NODE_ENV=prod npx sequelize db:migrate
```

The `--debug` flag can be added for verbose output (used in the CI/CD pipeline).

## Rolling Back

Undo the most recent migration:

```bash
NODE_ENV=dev npx sequelize db:migrate:undo
```

Undo all migrations:

```bash
NODE_ENV=dev npx sequelize db:migrate:undo:all
```

## Migration Status

Check which migrations have been applied:

```bash
NODE_ENV=dev npx sequelize db:migrate:status
```

## Seed Data

The `seeders/` directory exists but is empty. No seed data is configured. The test suite handles its own seeding in `jest/globalSetup.js`.

> 💡 Seed Data is basically dummy data that is used to populate the database with some initial values. For example, if you have a table of `users`, you can use seed data to populate it with some initial users.

To generate a seeder:

```bash
npx sequelize seed:generate --name seed-name
```

## Important Notes

- The application also runs `sequelize.sync()` on startup, which creates tables from model definitions if they do not exist. This means new models get their tables created automatically on first run, but schema changes to existing tables still require migrations.

- Migrations run as part of the CI/CD pipeline (GitHub Actions) before the PM2 process is reloaded. See [Deployment](deployment.md) for details.

- The migration files in this project use a mix of CommonJS and ES module syntax. Some older migrations may use `module.exports` while newer ones use `export default`.

- Always test migrations locally before pushing to main, as the CI/CD pipeline runs them directly against the production database.
