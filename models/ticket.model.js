import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';
import {
  STATUS_OPEN,
  STATUS_CLOSED,
  STATUS_INPROGRESS,
  STATUS_RESOLVED
} from '../config/constants.js';

const Ticket = sequelize.define(
  'Ticket',
  {
    id: {
      type: DataTypes.STRING,
      primaryKey: true
    },
    issued_by: {
      type: DataTypes.STRING,
      allowNull: false,
      references: {
        model: 'card_db',
        key: 'cardno'
      }
    },
    service: {
      type: DataTypes.STRING,
      allowNull: false
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: false
    },
    os: {
      type: DataTypes.ENUM,
      values: ['Android', 'iOS', 'Web', 'Other'],
      allowNull: true
    },
    app_version: {
      type: DataTypes.STRING,
      allowNull: true
    },
    status: {
      type: DataTypes.ENUM,
      values: [STATUS_OPEN, STATUS_INPROGRESS, STATUS_RESOLVED, STATUS_CLOSED],
      defaultValue: STATUS_OPEN,
      allowNull: false
    },
    updatedBy: {
      type: DataTypes.STRING,
      allowNull: true
    },
    metadata: {
      type: DataTypes.JSON,
      allowNull: true
    }
  },
  {
    tableName: 'tickets',
    timestamps: true
  }
);

// Every write that should count as "activity" on a ticket (a reply, a
// status change) must go through this instead of a bare .update() call.
// Sequelize's update()/save() silently skip the entire UPDATE — including
// the automatic updatedAt bump — when none of the given values actually
// differ from the current row (verified against this Sequelize version's
// source: lib/model.js save() computes options.fields from this.changed()
// and returns early when it's empty; empirically confirmed against a real
// DB too). That's reachable here: e.g. the same admin replying twice in a
// row with no status transition sends the same updatedBy value both times.
// The ticket auto-close cron's "reset the clock on activity" guarantee
// depends on updatedAt always advancing on activity, so we force `updatedBy`
// dirty unconditionally on every such update. Apply the updates first, then
// force the flag *last* (right before save) so set() — which .update() calls
// internally, and which can clear a pre-set dirty flag for an unchanged value
// — can't undo it. Robust across Sequelize versions, not just v6.
Ticket.prototype.recordActivity = function (updates, options) {
  this.set(updates);
  this.changed('updatedBy', true);
  return this.save(options);
};

export default Ticket;
