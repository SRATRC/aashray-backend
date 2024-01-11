import nodeMailer from 'nodemailer';

const sendMail = async (options) => {
  const transporter = nodeMailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    // service: process.env.SMTP_SERVICE,
    auth: {
      user: process.env.SMTP_EMAIL,
      pass: process.env.SMTP_PASSWORD
    }
  });

  const message = {
    from: `${process.env.SMTP_EMAIL}`,
    to: options.email,
    cc: options.cc || '',
    subject: options.subject,
    html: options.message
  };

  await transporter.sendMail(message);
};

export default sendMail;
