import moment from 'moment';
import {
  isSeniorCitizen,
  resolveSearchGenders,
  buildPriorityOrderClause
} from '../../helpers/roomBooking.helper.js';

describe('Room Allocation Engine - Scenarios and Priority Hierarchy', () => {
  const DEFAULT_PRIORITY = ['OAG_1st', 'OAG_2nd', 'NAG_1st', 'NAG_2nd'];

  describe('Gender Resolution & Dedicated Senior Pool Protection', () => {
    test('Scenario 1: Senior Male (age >= 60) searches dedicated SCM first, then regular M', () => {
      const searchPool = resolveSearchGenders('M', true);
      expect(searchPool).toEqual(['SCM', 'M']);
    });

    test('Scenario 1: Senior Female (age >= 60) searches dedicated SCF first, then regular F', () => {
      const searchPool = resolveSearchGenders('F', true);
      expect(searchPool).toEqual(['SCF', 'F']);
    });

    test('Scenario 2: Non-Senior Male (age < 60) searches ONLY regular M, protected from SCM', () => {
      const searchPool = resolveSearchGenders('M', false);
      expect(searchPool).toEqual(['M']);
      expect(searchPool).not.toContain('SCM');
    });

    test('Scenario 2: Non-Senior Female (age < 60) searches ONLY regular F, protected from SCF', () => {
      const searchPool = resolveSearchGenders('F', false);
      expect(searchPool).toEqual(['F']);
      expect(searchPool).not.toContain('SCF');
    });

    test('Scenario 3: Non-Senior with SCM/SCF input falls back to base gender M/F when isSenior is false', () => {
      expect(resolveSearchGenders('SCM', false)).toEqual(['M']);
      expect(resolveSearchGenders('SCF', false)).toEqual(['F']);
    });

    test('Scenario 4: Senior with legacy SCM input still resolves to [SCM, M]', () => {
      expect(resolveSearchGenders('SCM', true)).toEqual(['SCM', 'M']);
    });
  });

  describe('Floor Ordering & Building Priority Clauses', () => {
    test('Standard Priority (isGroundPref = false): preserves building-first sequence', () => {
      const clauses = buildPriorityOrderClause(DEFAULT_PRIORITY, false);
      expect(clauses).toHaveLength(3);
      // Case clause checks room numbers: 1-18 (OAG_1st), 19-36 (OAG_2nd), 37-48 (NAG_1st), 49-60 (NAG_2nd)
      const caseClauseText = clauses[0].val;
      expect(caseClauseText).toContain('BETWEEN 1 AND 18 THEN 1');
      expect(caseClauseText).toContain('BETWEEN 19 AND 36 THEN 2');
      expect(caseClauseText).toContain('BETWEEN 37 AND 48 THEN 3');
      expect(caseClauseText).toContain('BETWEEN 49 AND 60 THEN 4');
    });

    test('Senior / Ground Preference (isGroundPref = true): elevates Ground floors (1st) ahead of Upper (2nd)', () => {
      const clauses = buildPriorityOrderClause(DEFAULT_PRIORITY, true);
      const caseClauseText = clauses[0].val;
      // With ground pref: OAG_1st (pos 1), NAG_1st (pos 2), OAG_2nd (pos 3), NAG_2nd (pos 4)
      expect(caseClauseText).toContain('BETWEEN 1 AND 18 THEN 1'); // OAG_1st is index 1
      expect(caseClauseText).toContain('BETWEEN 37 AND 48 THEN 2'); // NAG_1st is index 2
      expect(caseClauseText).toContain('BETWEEN 19 AND 36 THEN 3'); // OAG_2nd is index 3
      expect(caseClauseText).toContain('BETWEEN 49 AND 60 THEN 4'); // NAG_2nd is index 4
    });

    test('Custom monthly priority (NAG first): respects NAG preference when isGroundPref is false', () => {
      const nagFirstPriority = ['NAG_1st', 'NAG_2nd', 'OAG_1st', 'OAG_2nd'];
      const clauses = buildPriorityOrderClause(nagFirstPriority, false);
      const caseClauseText = clauses[0].val;
      expect(caseClauseText).toContain('BETWEEN 37 AND 48 THEN 1'); // NAG_1st is 1
      expect(caseClauseText).toContain('BETWEEN 49 AND 60 THEN 2'); // NAG_2nd is 2
      expect(caseClauseText).toContain('BETWEEN 1 AND 18 THEN 3'); // OAG_1st is 3
      expect(caseClauseText).toContain('BETWEEN 19 AND 36 THEN 4'); // OAG_2nd is 4
    });
  });

  describe('Admin Room Change (availableRooms) Logic', () => {
    test('Scenario 6: Senior citizen booking offers both dedicated SC and regular rooms', () => {
      const seniorDob = moment().subtract(65, 'years').format('YYYY-MM-DD');
      const checkin = moment().add(5, 'days').format('YYYY-MM-DD');
      const isSenior = isSeniorCitizen(seniorDob, checkin);
      expect(resolveSearchGenders('M', isSenior)).toEqual(['SCM', 'M']);
      expect(resolveSearchGenders('F', isSenior)).toEqual(['SCF', 'F']);
    });

    test('Scenario 7: Non-senior booking offers ONLY regular rooms', () => {
      const youngDob = moment().subtract(30, 'years').format('YYYY-MM-DD');
      const checkin = moment().add(5, 'days').format('YYYY-MM-DD');
      const isSenior = isSeniorCitizen(youngDob, checkin);
      expect(resolveSearchGenders('M', isSenior)).toEqual(['M']);
      expect(resolveSearchGenders('F', isSenior)).toEqual(['F']);
    });

    test('Missing DOB offers ONLY regular rooms', () => {
      const checkin = moment().add(5, 'days').format('YYYY-MM-DD');
      const isSenior = isSeniorCitizen(null, checkin);
      expect(resolveSearchGenders('M', isSenior)).toEqual(['M']);
      expect(resolveSearchGenders('F', isSenior)).toEqual(['F']);
    });
  });
});
