import { SupportTickets } from '../../models/associations.js';
import sendMail from '../../utils/sendMail.js';
import database from '../../config/database.js';

export const createTicket = async (req, res) => {
  const { service, issue } = req.body;
  const t = await database.transaction();

  await SupportTickets.create(
    {
      issued_by: req.user.cardno,
      service,
      issue
    },
    { transaction: t }
  );

  await t.commit();

  // sendMail({
  //   email: 'tech@vitraagvigyaan.org',
  //   subject: `New support ticket created by ${req.user.issuedto}`,
  //   html: `
  //   <p>New support ticket created by ${req.user.issuedto}</p>
  //   <p><b>Service:</b> ${service}</p>
  //   <p><b>Issue:</b> ${issue}</p>
  //   `
  // });

  return res.status(201).json({
    success: true,
    message: 'Ticket created successfully'
  });
};
