import nodeMailer from 'nodemailer';
import hbs from 'nodemailer-express-handlebars';
import logger from '../config/logger.js';

const templateDir = process.cwd() + '/emails';

const sendMail = async (options) => {
  const transporter = nodeMailer.createTransport({
    host: process.env.SES_SMTP_HOST,
    port: process.env.SES_SMTP_PORT,
    auth: {
      user: process.env.SES_SMTP_USERNAME,
      pass: process.env.SES_SMTP_PASSWORD
    }
  });

  const handlebarOptions = {
    viewEngine: {
      extname: '.hbs',
      layoutsDir: templateDir,
      defaultLayout: false,
      partialsDir: templateDir
    },
    viewPath: templateDir,
    extName: '.hbs'
  };

  transporter.use('compile', hbs(handlebarOptions));

  transporter.sendMail(
    {
      from: `"Vitraag Vigyaan Aashray" <${process.env.SES_SMTP_EMAIL}>`,
      to: options.email,
      cc: options.cc || '',
      subject: options.subject,
      template: options.template,
      context: options.context,
      headers: {
        'X-SES-CONFIGURATION-SET': 'aashray-config-set'
      }
    },
    (error, info) => {
      if (error) {
        logger.error(`Email sending failed: ${error.message}`);
        return;
      }
      logger.info(`Email sent to ${options.email}: ${info.messageId}`);
    }
  );
};

export default sendMail;
