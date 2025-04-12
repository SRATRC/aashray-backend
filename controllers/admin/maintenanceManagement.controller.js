import {
    STATUS_INPROGRESS,
    STATUS_OPEN,
    STATUS_CLOSED
  } from '../../config/constants.js';
  import { QueryTypes } from 'sequelize';
  import database from '../../config/database.js';
  
  export const fetchMaintenanceReport = async (req, res) => {
    const requests = await database.query(
      `
          SELECT 
    m.bookingid,
    m.requested_by,
    c.issuedto,
    c.mobno,
    m.createdAt,
    m.department,
    m.work_detail,
    m.area_of_work,
    m.comments,
    m.status
FROM 
    maintenance_db m
JOIN 
    card_db c ON m.requested_by = c.cardno;`,
      {
        type: QueryTypes.SELECT,
        raw: true,
        replacements: {
          status: [STATUS_INPROGRESS, STATUS_OPEN, STATUS_CLOSED]
        }
      }
    );
  
    return res.status(200).send({
      message: 'Fetched all requests',
      data: requests
    });
  };
  