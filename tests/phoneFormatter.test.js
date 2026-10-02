import { formatWhatsAppPhone } from '../utils/phoneFormatter.js';

describe('formatWhatsAppPhone', () => {
  it('should return null for null, undefined, or empty inputs', () => {
    expect(formatWhatsAppPhone(null)).toBeNull();
    expect(formatWhatsAppPhone(undefined)).toBeNull();
    expect(formatWhatsAppPhone('')).toBeNull();
  });

  it('should format Indian numbers correctly', () => {
    // 10 digits
    expect(formatWhatsAppPhone('9876543210', 'India')).toBe('919876543210');
    expect(formatWhatsAppPhone(9876543210, 'India')).toBe('919876543210');
    // Already has 91 (12 digits)
    expect(formatWhatsAppPhone('919876543210', 'India')).toBe('919876543210');
    // Default fallback to India if country is null or empty
    expect(formatWhatsAppPhone('9876543210')).toBe('919876543210');
    expect(formatWhatsAppPhone('9876543210', '')).toBe('919876543210');
    expect(formatWhatsAppPhone('9876543210', null)).toBe('919876543210');
  });

  it('should format USA numbers correctly', () => {
    expect(formatWhatsAppPhone('8475053947', 'United States')).toBe('18475053947');
    expect(formatWhatsAppPhone('8475053947', 'USA')).toBe('18475053947');
    expect(formatWhatsAppPhone('18475053947', 'United States')).toBe('18475053947');
  });

  it('should format UAE/Dubai numbers correctly', () => {
    // 9 digits
    expect(formatWhatsAppPhone('564701767', 'United Arab Emirates')).toBe('971564701767');
    expect(formatWhatsAppPhone('503984863', 'UAE')).toBe('971503984863');
    expect(formatWhatsAppPhone('552397487', 'Dubai')).toBe('971552397487');
    // Already has country code
    expect(formatWhatsAppPhone('971564701767', 'United Arab Emirates')).toBe('971564701767');
    // UAE numbers stored with leading 1 (10 digits)
    expect(formatWhatsAppPhone('1504504553', 'United Arab Emirates')).toBe('971504504553');
  });

  it('should format UK numbers correctly', () => {
    expect(formatWhatsAppPhone('7400123456', 'United Kingdom')).toBe('447400123456');
    expect(formatWhatsAppPhone('7400123456', 'UK')).toBe('447400123456');
  });

  it('should format other mapped countries correctly', () => {
    expect(formatWhatsAppPhone('171234567', 'Germany')).toBe('49171234567');
    expect(formatWhatsAppPhone('61395000000', 'Australia')).toBe('61395000000');
  });

  it('should fallback gracefully for unmapped countries', () => {
    // If length > 10, keep as is assuming it has country code
    expect(formatWhatsAppPhone('33123456789', 'France')).toBe('33123456789');
    // If length <= 10, default to prepending 91
    expect(formatWhatsAppPhone('1234567890', 'France')).toBe('911234567890');
  });
});
