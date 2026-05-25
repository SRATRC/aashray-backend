import { sendWhatsAppMessage } from '../utils/sendWhatsAppMessage.js';

export async function sendCoordinatorOtp(
  phone,
  otp
) {

  const components = [

    {
      type: 'body',

      parameters: [
        {
          type: 'text',
          text: String(otp),
        },
        {
          type: 'text',
          text: 'login',
        },
      ],
    },

    {
      type: 'button',
      sub_type: 'url',
      index: '0',

      parameters: [
        {
          type: 'text',
          text: String(otp),
        },
      ],
    },

  ];

  await sendWhatsAppMessage(
    phone,
    'coordinator_login_otp',
    components
  );
}