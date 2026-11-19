import moment from 'moment';
import { isSeniorCitizen } from '../../helpers/roomBooking.helper.js';

describe('Room Allocation - Senior Citizen Detection and Logic', () => {
  test('isSeniorCitizen: age >= 60 returns true', () => {
    const dob65 = moment().subtract(65, 'years').format('YYYY-MM-DD');
    const dob60 = moment().subtract(60, 'years').format('YYYY-MM-DD');
    expect(isSeniorCitizen(dob65)).toBe(true);
    expect(isSeniorCitizen(dob60)).toBe(true);
  });

  test('isSeniorCitizen: age < 60 returns false even if floorPref is SC', () => {
    const dob25 = moment().subtract(25, 'years').format('YYYY-MM-DD');
    const dob59 = moment().subtract(59, 'years').format('YYYY-MM-DD');
    expect(isSeniorCitizen(dob25)).toBe(false);
    expect(isSeniorCitizen(dob59)).toBe(false);
    // Non-senior selecting 'SC' in dropdown must NOT be classified as verified senior
    expect(isSeniorCitizen(dob25, 'SC')).toBe(false);
  });

  test('isSeniorCitizen: null or empty DOB falls back to floorPref', () => {
    expect(isSeniorCitizen(null, 'SC')).toBe(true);
    expect(isSeniorCitizen(undefined, 'SC')).toBe(true);
    expect(isSeniorCitizen(null, '')).toBe(false);
    expect(isSeniorCitizen(null, null)).toBe(false);
  });

  test('isSeniorCitizen: invalid DOB string falls back to floorPref', () => {
    expect(isSeniorCitizen('invalid-date', 'SC')).toBe(true);
    expect(isSeniorCitizen('invalid-date', '')).toBe(false);
  });
});
