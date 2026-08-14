// Block-feature correctness bugfixes (C1, I1, I3) + block_dates reject-vs-split.
//
// NOTE: like the other suites in this sandbox these cannot currently run green —
// there is a pre-existing fresh-DB bootstrap issue unrelated to these changes.
// They are authored to be correct in structure and to lock the intended
// behavior once the DB bootstrap is fixed.
//
// Locked rule under test: "blocked = unavailable, never bookable; attended-utsav
// → split → bookable."
import request from 'supertest';
import moment from 'moment';
import { app, sequelize } from '../../../app.js';
import {
  CardDb,
  RoomBooking,
  UtsavDb,
  UtsavBooking,
  UtsavPackagesDb
} from '../../../models/associations.js';
import BlockDates from '../../../models/block_dates.model.js';
import CardFactory from '../../factories/cardFactory.js';
import { splitDateRanges } from '../../../helpers/utsavBooking.helper.js';
import {
  STATUS_ACTIVE,
  STATUS_CONFIRMED,
  RESEARCH_CENTRE,
  TYPE_ROOM
} from '../../../config/constants.js';

jest.mock('../../../utils/sendMail.js');

const fmt = (m) => m.format('YYYY-MM-DD');
const post = (body) =>
  request(app).post('/api/v1/stay/check-blocked-dates').send(body);
const postRoomValidate = (body) =>
  request(app).post('/api/v1/mumukshu/validate').send(body);
const roomBookingJson = (cardno, checkin, checkout) => ({
  booking_type: TYPE_ROOM,
  details: {
    checkin_date: checkin,
    checkout_date: checkout,
    mumukshuGroup: [{ roomType: 'ac', floorType: '', mumukshus: [cardno] }]
  }
});

const CARD = 'BLK_BUG_1';
const ATTENDEE = 'BLK_BUG_ATT_1';

// I3 (pure unit): splitDateRanges must start the post-festival segment the night
// AFTER end_date so the utsav's own auto-block (checkin=start, checkout=end+1)
// never flags an attending member's extension.
describe('splitDateRanges post segment (I3, pure)', () => {
  const utsavStart = '2026-08-10';
  const utsavEnd = '2026-08-14'; // block covers nights 10..14, checkout = Aug15

  it('starts the post segment at end_date + 1 (departure day exclusive)', () => {
    const ranges = splitDateRanges(utsavStart, utsavEnd, '2026-08-10', '2026-08-18');
    const post = ranges[ranges.length - 1];
    expect(post.start).toBe('2026-08-15'); // NOT Aug14 (a blocked festival night)
    expect(post.end).toBe('2026-08-18');
    expect(post.overlappingWithUtsav).toBe(true); // boundary behavior preserved
  });

  it('produces NO post segment when the booking ends exactly at end_date + 1', () => {
    const ranges = splitDateRanges(utsavStart, utsavEnd, '2026-08-10', '2026-08-15');
    expect(ranges).toHaveLength(0);
  });

  it('a single genuine post-festival night stays a 1-night boundary range', () => {
    const ranges = splitDateRanges(utsavStart, utsavEnd, '2026-08-10', '2026-08-16');
    const post = ranges[ranges.length - 1];
    expect(post.start).toBe('2026-08-15');
    expect(moment(post.end).diff(moment(post.start), 'days')).toBe(1);
  });
});

describe('POST /stay/check-blocked-dates block bugfixes', () => {
  beforeAll(async () => {
    await sequelize.query('SET FOREIGN_KEY_CHECKS = 0');
    await RoomBooking.truncate();
    await sequelize.query('SET FOREIGN_KEY_CHECKS = 1');
    await CardFactory.create(CARD);
    await CardFactory.create(ATTENDEE);
  });

  afterAll(async () => {
    await BlockDates.destroy({ where: { comments: ['C1 same-day', 'I1 multi-day'] } });
    await UtsavBooking.destroy({ where: { cardno: ATTENDEE } });
    await CardDb.destroy({ where: { cardno: [CARD, ATTENDEE] } });
  });

  // C1: a manual same-day (zero-length) block must reject a booking that STARTS
  // on the blocked day. Before the fix getBlockedDates never returned the block.
  it('C1: same-day block rejects a booking starting on the blocked day', async () => {
    const day = fmt(moment().add(40, 'day'));
    const next = fmt(moment().add(41, 'day'));
    await BlockDates.create({
      checkin: day,
      checkout: day, // zero-length manual block
      comments: 'C1 same-day',
      status: STATUS_ACTIVE,
      updatedBy: 'test'
    });

    const res = await post({ cardno: CARD, checkin: day, checkout: next });
    expect(res.status).toBe(200);
    expect(res.body.isBlocked).toBe(true);
    expect(res.body.blockedAction).toBe('reject');
  });

  // I1: a day visit (checkin === checkout) landing on a multi-day block must be a
  // hard reject, never a mislabeled 'split'.
  it('I1: day visit onto a blocked day yields reject (not split)', async () => {
    const start = fmt(moment().add(50, 'day'));
    const end = fmt(moment().add(55, 'day'));
    const visit = fmt(moment().add(52, 'day'));
    await BlockDates.create({
      checkin: start,
      checkout: end,
      comments: 'I1 multi-day',
      status: STATUS_ACTIVE,
      updatedBy: 'test'
    });

    const res = await post({ cardno: CARD, checkin: visit, checkout: visit });
    expect(res.status).toBe(200);
    expect(res.body.isBlocked).toBe(true);
    expect(res.body.blockedAction).toBe('reject');
  });

  // Reject-vs-split contract: an ATTENDING member's stay spanning a utsav is a
  // legit split (festival gap excluded → no surviving isBlocked range), while a
  // NON-attendee over the same festival block is a reject.
  it('block_dates: attended utsav span → split, non-attendee → reject', async () => {
    const uStart = fmt(moment().add(70, 'day'));
    const uEnd = fmt(moment().add(74, 'day'));
    const utsav = await UtsavDb.create({
      name: 'BLK_BUG Utsav',
      start_date: uStart,
      end_date: uEnd,
      month: moment(uStart).format('MMMM'),
      total_seats: 100,
      location: RESEARCH_CENTRE,
      available_seats: 100
    });
    const pkg = await UtsavPackagesDb.create({
      utsavid: utsav.id,
      name: 'Full',
      start_date: uStart,
      end_date: uEnd,
      amount: 0
    });
    // The utsav's auto-block (mirrors createUtsav: checkin=start, checkout=end+1).
    await BlockDates.create({
      checkin: uStart,
      checkout: fmt(moment(uEnd).add(1, 'day')),
      comments: 'BLK_BUG Utsav',
      status: STATUS_ACTIVE,
      updatedBy: 'test'
    });
    // ATTENDEE has a confirmed booking for this utsav.
    await UtsavBooking.create({
      bookingid: 'BLK_BUG_UB_1',
      utsavid: utsav.id,
      cardno: ATTENDEE,
      packageid: pkg.id,
      status: STATUS_CONFIRMED,
      updatedBy: 'test'
    });

    const before = fmt(moment().add(68, 'day'));
    const after = fmt(moment().add(77, 'day'));

    // Attendee: stay wraps the festival → split (bookable).
    const attRes = await post({ mumukshus: [ATTENDEE], checkin: before, checkout: after });
    expect(attRes.status).toBe(200);
    expect(attRes.body.isBlocked).toBe(true);
    expect(attRes.body.blockedAction).toBe('split');

    // Non-attendee: same span, not attending → reject.
    const nonRes = await post({ mumukshus: [CARD], checkin: before, checkout: after });
    expect(nonRes.status).toBe(200);
    expect(nonRes.body.blockedAction).toBe('reject');

    await UtsavBooking.destroy({ where: { bookingid: 'BLK_BUG_UB_1' } });
    await BlockDates.destroy({ where: { comments: 'BLK_BUG Utsav' } });
    await UtsavPackagesDb.destroy({ where: { id: pkg.id } });
    await UtsavDb.destroy({ where: { id: utsav.id } });
  });

  // getDateRangesDuringUtsav (used by the real room-validate path, not by
  // check-blocked-dates above) had its own copy of the same zero-length-block
  // bug as C1: it read blockedDate.checkin/checkout straight off the DB row
  // instead of normalizing through blockNightBounds first, so a same-day block
  // was only caught when the stay started strictly BEFORE it, never when the
  // stay started exactly ON it.
  it('same-day block rejects a room booking starting exactly on the blocked day', async () => {
    const day = fmt(moment().add(90, 'day'));
    const dayBefore = fmt(moment().add(89, 'day'));
    const checkout = fmt(moment().add(106, 'day'));
    await BlockDates.create({
      checkin: day,
      checkout: day, // zero-length manual block, same shape as C1
      comments: 'C1b same-day (getDateRangesDuringUtsav)',
      status: STATUS_ACTIVE,
      updatedBy: 'test'
    });

    // Starting exactly on the blocked day: previously slipped through unblocked.
    const onRes = await postRoomValidate({
      cardno: CARD,
      primary_booking: roomBookingJson(CARD, day, checkout)
    });
    expect(onRes.status).toBe(200);
    expect(onRes.body.data.roomDetails.some((r) => r.isBlocked)).toBe(true);

    // Starting the day before: already worked before this fix, must still work.
    const beforeRes = await postRoomValidate({
      cardno: CARD,
      primary_booking: roomBookingJson(CARD, dayBefore, checkout)
    });
    expect(beforeRes.status).toBe(200);
    expect(beforeRes.body.data.roomDetails.some((r) => r.isBlocked)).toBe(true);

    await BlockDates.destroy({
      where: { comments: 'C1b same-day (getDateRangesDuringUtsav)' }
    });
  });
});
