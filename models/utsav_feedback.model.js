import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';
import {
  RESEARCH_CENTRE,
  STATUS_CLOSED,
  STATUS_OPEN
} from '../config/constants.js';
// import { UtsavFeedback } from './associations.js';

  const UtsavFeedback = sequelize.define(
    'UtsavFeedback',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },

      /* ------------------------------------------------------------------ */
      /*                          USER / CONTEXT                             */
      /* ------------------------------------------------------------------ */

      cardno: {
        type: DataTypes.STRING(20),
        allowNull: false,
      },

      utsav_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },

      mumukshu_name: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },

      accommodation_type: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },

      room_number: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },

      /* ------------------------------------------------------------------ */
      /*                              RATINGS                                */
      /* ------------------------------------------------------------------ */

      accommodation_rating: {
        type: DataTypes.TINYINT,
        allowNull: false,
      },

      qr_rating: {
        type: DataTypes.TINYINT,
        allowNull: false,
      },

      food_rating: {
        type: DataTypes.TINYINT,
        allowNull: false,
      },

      program_rating: {
        type: DataTypes.TINYINT,
        allowNull: false,
      },

      volunteer_rating: {
        type: DataTypes.TINYINT,
        allowNull: false,
      },

      infrastructure_rating: {
        type: DataTypes.TINYINT,
        allowNull: false,
      },

      decor_rating: {
        type: DataTypes.TINYINT,
        allowNull: false,
      },

      internal_transport_rating: {
        type: DataTypes.TINYINT,
        allowNull: false,
      },

      raj_pravas_rating: {
        type: DataTypes.TINYINT,
        allowNull: false,
      },

      sparsh_rating: {
        type: DataTypes.TINYINT,
        allowNull: false,
      },

      av_rating: {
        type: DataTypes.TINYINT,
        allowNull: false,
      },

      /* ------------------------------------------------------------------ */
      /*                             FEEDBACK                                */
      /* ------------------------------------------------------------------ */

      loved_most: {
        type: DataTypes.TEXT,
        allowNull: false,
      },

      improvement_suggestions: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
    },
    {
      tableName: 'utsav_feedback',
      timestamps: true,
      underscored: true,

      indexes: [
        {
          fields: ['utsav_id'],
        },
        {
          fields: ['cardno'],
        },
        {
          unique: true,
          fields: ['utsav_id', 'cardno'], // prevents duplicate feedback
        },
      ],
    }
  );

  /* ---------------------------------------------------------------------- */
  /*                               ASSOCIATIONS                              */
  /* ---------------------------------------------------------------------- */

  UtsavFeedback.associate = (models) => {
    // Optional – if you already have these models
    UtsavFeedback.belongsTo(models.UtsavDb, {
      foreignKey: 'utsav_id',
    });

    UtsavFeedback.belongsTo(models.CardDb, {
      foreignKey: 'cardno',
      targetKey: 'cardno',
    });
  };

export default UtsavFeedback;

