import { jest } from '@jest/globals';
import { sendWhatsAppMessage } from '../../utils/sendWhatsAppMessage.js';
import { sendFlatWhatsApp } from '../../helpers/whatsapp.helper.js';

// sendFlatWhatsApp dispatches every template through sendWhatsAppMessage
// (via the private sendWithTemplateFallback). A waiting flat booking must be
// skipped before any dispatch, so the mock is never called.
jest.mock('../../utils/sendWhatsAppMessage.js');

test('sendFlatWhatsApp skips waiting flat bookings (no message sent)', async () => {
  const user = {
    cardno: 'C1',
    mobno: '9999999999',
    country: 'India',
    issuedto: 'Test'
  };

  await sendFlatWhatsApp(user, [
    {
      bookingid: 'B1',
      status: 'waiting',
      checkin: '2026-03-01',
      checkout: '2026-03-12'
    }
  ]);

  expect(sendWhatsAppMessage).not.toHaveBeenCalled();
});
