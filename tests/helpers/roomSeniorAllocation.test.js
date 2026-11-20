import moment from 'moment';
import { isSeniorCitizen } from '../../helpers/roomBooking.helper.js';

describe('Room Allocation - Senior Citizen Detection and Logic', () => {
  test('isSeniorCitizen: age >= 60 returns true', () => {
    const dob65 = moment().subtract(65, 'years').format('YYYY-MM-DD');
    const dob60 = moment().subtract(60, 'years').format('YYYY-MM-DD');
    expect(isSeniorCitizen(dob65)).toBe(true);
    expect(isSeniorCitizen(dob60)).toBe(true);
  });

  test('isSeniorCitizen: age < 60 returns false', () => {
    const dob25 = moment().subtract(25, 'years').format('YYYY-MM-DD');
    const dob59 = moment().subtract(59, 'years').format('YYYY-MM-DD');
    expect(isSeniorCitizen(dob25)).toBe(false);
    expect(isSeniorCitizen(dob59)).toBe(false);
  });

  test('isSeniorCitizen: age calculated against referenceDate (check-in date)', () => {
    // Guest turns 60 in 10 days
    const dob = moment().subtract(60, 'years').add(10, 'days').format('YYYY-MM-DD');
    const futureCheckin = moment().add(15, 'days').format('YYYY-MM-DD');
    // Today they are 59:
    expect(isSeniorCitizen(dob)).toBe(false);
    // On future check-in date they will be 60:
    expect(isSeniorCitizen(dob, futureCheckin)).toBe(true);
  });

  test('isSeniorCitizen: null, empty or invalid DOB returns false (treated as non-senior for SCM/SCF)', () => {
    expect(isSeniorCitizen(null)).toBe(false);
    expect(isSeniorCitizen(undefined)).toBe(false);
    expect(isSeniorCitizen('')).toBe(false);
    expect(isSeniorCitizen('invalid-date')).toBe(false);
  });
});
