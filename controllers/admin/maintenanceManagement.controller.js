import {
  STATUS_INPROGRESS,
  STATUS_OPEN,
  STATUS_CLOSED
} from '../../config/constants.js';
import { QueryTypes } from 'sequelize';
import database from '../../config/database.js';

// export const  fetchMaintenanceReport = async (req, res) => {
//   const { department } = req.params;

//   const requests = await database.query(
//     `
//       SELECT 
//         m.bookingid,
//         m.requested_by,
//         c.issuedto,
//         c.mobno,
//         m.createdAt,
//         m.department,
//         m.work_detail,
//         m.area_of_work,
//         m.comments,
//         m.status
//       FROM 
//         maintenance_db m
//       JOIN 
//         card_db c ON m.requested_by = c.cardno
//       WHERE 
//         m.department = :department
//     `,
//     {
//       type: QueryTypes.SELECT,
//       raw: true,
//       replacements: {
//         department,
//         status: [STATUS_INPROGRESS, STATUS_OPEN, STATUS_CLOSED]
//       }
//     }
//   );

//   return res.status(200).send({
//     message: 'Fetched requests for department',
//     data: requests
//   });
// };

import { Maintenance } from '../../models/maintenance_db.js';
import { Card } from '../../models/card.js';

export const fetchMaintenanceReport = async (req, res) => {
  const { department } = req.params;

  const requests = await Maintenance.findAll({
    where: { department },
    include: [
      {
        model: Card,
        as: 'card', // must match association alias
        attributes: ['issuedto', 'mobno']
      }
    ],
    attributes: [
      'bookingid',
      'requested_by',
      'createdAt',
      'department',
      'work_detail',
      'area_of_work',
      'comments',
      'status'
    ]
  });

  return res.status(200).send({
    message: 'Fetched requests for department',
    data: requests
  });
};
