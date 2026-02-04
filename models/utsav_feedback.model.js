import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const UtsavFeedback = sequelize.define(
  'UtsavFeedback',
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    cardno: {
      type: DataTypes.STRING,
      allowNull: false,
      references: {
        model: 'card_db',
        key: 'cardno'
      }
    },
    utsav_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'utsav_db',
        key: 'id'
      }
    },
    accommodation_rating: {
      type: DataTypes.INTEGER,
      allowNull: false,
      validate: {
        min: 1,
        max: 5
      }
    },
    qr_rating: {
      type: DataTypes.INTEGER,
      allowNull: false,
      validate: {
        min: 1,
        max: 5
      }
    },
    food_rating: {
      type: DataTypes.INTEGER,
      allowNull: false,
      validate: {
        min: 1,
        max: 5
      }
    },
    program_rating: {
      type: DataTypes.INTEGER,
      allowNull: false,
      validate: {
        min: 1,
        max: 5
      }
    },
    volunteer_rating: {
      type: DataTypes.INTEGER,
      allowNull: false,
      validate: {
        min: 1,
        max: 5
      }
    },
    infrastructure_rating: {
      type: DataTypes.INTEGER,
      allowNull: false,
      validate: {
        min: 1,
        max: 5
      }
    },
    decor_rating: {
      type: DataTypes.INTEGER,
      allowNull: false,
      validate: {
        min: 1,
        max: 5
      }
    },
    internal_transport_rating: {
      type: DataTypes.INTEGER,
      allowNull: false,
      validate: {
        min: 1,
        max: 5
      }
    },
    raj_pravas_rating: {
      type: DataTypes.INTEGER,
      allowNull: false,
      validate: {
        min: 1,
        max: 5
      }
    },
    sparsh_rating: {
      type: DataTypes.INTEGER,
      allowNull: false,
      validate: {
        min: 1,
        max: 5
      }
    },
    av_rating: {
      type: DataTypes.INTEGER,
      allowNull: false,
      validate: {
        min: 1,
        max: 5
      }
    },
    loved_most: {
      type: DataTypes.TEXT,
      allowNull: false
    },
    improvement_suggestions: {
      type: DataTypes.TEXT,
      allowNull: false
    }
  },
  {
    tableName: 'utsav_feedback',
    timestamps: true,
    indexes: [
      {
        fields: ['utsav_id']
      },
      {
        fields: ['cardno']
      },
      {
        unique: true,
        fields: ['utsav_id', 'cardno'],
        name: 'unique_feedback_per_user_per_utsav'
      }
    ]
  }
);

UtsavFeedback.associate = (models) => {
  UtsavFeedback.belongsTo(models.UtsavDb, {
    foreignKey: 'utsav_id',
    targetKey: 'id'
  });

  UtsavFeedback.belongsTo(models.CardDb, {
    foreignKey: 'cardno',
    targetKey: 'cardno'
  });
};

export default UtsavFeedback;
