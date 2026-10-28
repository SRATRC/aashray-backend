import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

// One row per uploaded ticket media object. Normalized (rather than a JSON
// column on the ticket/message) so the retention cron can scan by uploaded_at,
// the serve endpoint can authorize + resolve a single object by id, and the
// per-ticket video cap can be counted with an index. `message_id` is null for
// media filed at ticket creation (ticket-level). `expired_at` is a tombstone
// set by the cleanup cron once the S3 object has been deleted — the row is kept
// so the UI can explain the gap and so we never re-attempt the delete.
const TicketAttachment = sequelize.define(
  'TicketAttachment',
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    ticket_id: {
      type: DataTypes.STRING,
      allowNull: false,
      references: {
        model: 'tickets',
        key: 'id'
      }
    },
    message_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'ticket_messages',
        key: 'id'
      }
    },
    s3_key: {
      type: DataTypes.STRING,
      allowNull: false
    },
    content_type: {
      type: DataTypes.STRING,
      allowNull: false
    },
    kind: {
      type: DataTypes.ENUM,
      values: ['image', 'video'],
      allowNull: false
    },
    size: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    uploaded_by: {
      type: DataTypes.STRING,
      allowNull: false
    },
    uploaded_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    },
    expired_at: {
      type: DataTypes.DATE,
      allowNull: true
    }
  },
  {
    tableName: 'ticket_attachments',
    timestamps: true
  }
);

export default TicketAttachment;
