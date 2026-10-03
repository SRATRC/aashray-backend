/**
 * Formats a phone number for WhatsApp API delivery.
 * @param {string|number} mobno - The raw mobile number.
 * @param {string} [country] - The country name associated with the number.
 * @returns {string|null} The formatted phone number with country code.
 */
export function formatWhatsAppPhone(mobno, country) {
  if (mobno === null || mobno === undefined || mobno === '') return null;

  // Clean all non-digit characters
  let cleanPhone = String(mobno).replace(/\D/g, '');

  // Normalize country name
  const countryStr = country ? String(country).trim().toLowerCase() : '';

  // Handle India (default fallback)
  if (!countryStr || countryStr === 'india') {
    if (cleanPhone.length === 10) {
      return `91${cleanPhone}`;
    }
    if (cleanPhone.startsWith('91') && cleanPhone.length === 12) {
      return cleanPhone;
    }
    return cleanPhone.startsWith('91') ? cleanPhone : `91${cleanPhone}`;
  }

  // Country code mappings
  const COUNTRY_CODES = {
    'united states': '1',
    'united states of america': '1',
    'usa': '1',
    'united arab emirates': '971',
    'uae': '971',
    'dubai': '971',
    'united kingdom': '44',
    'uk': '44',
    'germany': '49',
    'canada': '1',
    'egypt': '20',
    'australia': '61',
    'singapore': '65',
    'new zealand': '64',
    'kenya': '254',
    'south africa': '27'
  };

  const code = COUNTRY_CODES[countryStr];
  if (code) {
    // Correct UAE numbers stored with an erroneous leading '1' (e.g. 1504504553 -> 504504553 -> 971504504553)
    if (code === '971' && cleanPhone.startsWith('1') && cleanPhone.length === 10) {
      cleanPhone = cleanPhone.substring(1);
    }

    if (cleanPhone.startsWith(code)) {
      return cleanPhone;
    }
    return `${code}${cleanPhone}`;
  }

  // Default fallback if country is not mapped
  if (cleanPhone.length > 10) {
    return cleanPhone;
  }
  return `91${cleanPhone}`;
}
