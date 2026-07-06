import nodeMailer from 'nodemailer';
import hbs from 'nodemailer-express-handlebars';
import logger from '../config/logger.js';

const templateDir = process.cwd() + '/emails';

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

const sendMail = async (options, log = logger) => {
  transporter.sendMail(
    {
      from: `"Vitraag Vigyaan Aashray" <${process.env.SES_SMTP_EMAIL}>`,
      to: options.email,
      cc: options.cc || '',
      subject: options.subject,
      template: options.template,
      context: options.context,
      headers: {
        'X-SES-CONFIGURATION-SET': 'aashrayconfigset'
      }
    },
    (error, info) => {
      if (error) {
        log.error('email_send_failed', { email: options.email, error: error.message });
        return;
      }
      log.info('email_sent', { email: options.email, messageId: info.messageId });
    }
  );
};

export default sendMail;
