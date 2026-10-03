import { SupportTickets } from '../../models/associations.js';
import { attachUserContext } from '../../middleware/Logger.js';
import sendMail from '../../utils/sendMail.js';
import database from '../../config/database.js';

export const createTicket = async (req, res) => {
  attachUserContext(req);
  const { service, issue } = req.body;
  req.log.info('create_support_ticket_start', { cardno: req.user.cardno, service });

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
  req.log.info('create_support_ticket_success', { cardno: req.user.cardno, service });

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
