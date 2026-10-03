import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const UtsavRoomConfig = sequelize.define(
  'UtsavRoomConfig',
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    utsavid: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'utsav_db',
        key: 'id'
      }
    },
    // For RC rooms: '17', '38'. For external: 'HotelName_101'
    room_group: {
      type: DataTypes.STRING(30),
      allowNull: false
    },
    // RC_OAG | RC_NAG | External hotel name
    property: {
      type: DataTypes.STRING(50),
      allowNull: false
    },
    // true = RC rooms (from roomdb), false = external hotel
    is_inside_rc: {
      type: DataTypes.TINYINT,
      defaultValue: 1
    },
    // 0 = Ground Floor, 1 = First Floor
    floor: {
      type: DataTypes.TINYINT,
      defaultValue: 0
    },
    // For RC: derived from roomdb (count of beds). For external: entered manually.
    base_capacity: {
      type: DataTypes.TINYINT,
      defaultValue: 0
    },
    // Floor mats / extra bedding added for this specific event
    addl_capacity: {
      type: DataTypes.TINYINT,
      defaultValue: 0
    },
    // Block this room for this event only (does not affect roomdb)
    is_blocked: {
      type: DataTypes.TINYINT,
      defaultValue: 0
    },
    // Per-event gender override. Blank = use roomdb.gender as default
    gender_override: {
      type: DataTypes.ENUM('M', 'F', ''),
      defaultValue: ''
    },
    // Runtime: which gender is currently staying (set as allocation fills room)
    gender_staying: {
      type: DataTypes.ENUM('M', 'F', ''),
      defaultValue: ''
    },
    // Runtime: remaining capacity (decremented during allocation run)
    avail_capacity: {
      type: DataTypes.TINYINT,
      defaultValue: 0
    },
    // Sort order for allocation pass (lower = higher priority)
    alloc_rank: {
      type: DataTypes.INTEGER,
      defaultValue: null,
      allowNull: true
    },
    // Admin notes for this room for this event
    notes: {
      type: DataTypes.STRING(255),
      defaultValue: null,
      allowNull: true
    }
  },
  {
    tableName: 'utsav_room_config',
    timestamps: true,
    indexes: [
      {
        unique: true,
        fields: ['utsavid', 'room_group', 'property']
      }
    ]
  }
);

export default UtsavRoomConfig;
