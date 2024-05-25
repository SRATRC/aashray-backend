import nodeMailer from 'nodemailer';
import hbs from 'nodemailer-express-handlebars';
import path from 'path';

const templateDir = process.cwd() + '/emails';

const sendMail = async (options) => {
  const transporter = nodeMailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    auth: {
      user: process.env.SMTP_EMAIL,
      pass: process.env.SMTP_PASSWORD
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
      from: `${process.env.SMTP_EMAIL}`,
      to: options.email,
      cc: options.cc || '',
      subject: options.subject,
      template: options.template,
      context: options.context
    },
    (error, info) => {
      if (error) {
        return console.log(error);
      }
    }
  );
};

export default sendMail;
