// Blocked dates during an event must reject EVERYONE, attendee or not.
//
// Production bug: a member who booked the utsav could request a room stay that
// falls entirely inside the utsav's blocked span and the API accepted it, while
// the same request from a non-attendee was correctly rejected.
//
// Root cause: the attended-utsav split removes the festival days from the stay.
// When the whole requested stay sits inside the festival, the split yields ZERO
// ranges, and the blocked-date validation ran over that empty list — so nothing
// was checked and nothing was rejected.
//
// Second hole in the same function: a day visit returned before the blocked-date
// validation entirely, so a day visit onto a blocked date was never checked.
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
import { checkRoomAvailabilityForMumukshus } from '../../../helpers/roomBooking.helper.js';
import { splitDateRanges } from '../../../helpers/utsavBooking.helper.js';
import {
  STATUS_ACTIVE,
  STATUS_CONFIRMED,
  RESEARCH_CENTRE,
  TYPE_ROOM
} from '../../../config/constants.js';

jest.mock('../../../utils/sendMail.js');

const fmt = (m) => m.format('YYYY-MM-DD');
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

const ATTENDEE = 'EVT_IN_ATT';
const OUTSIDER = 'EVT_IN_OUT';

// Utsav far enough out that no other suite's fixtures collide with it.
const U_START = fmt(moment().add(140, 'day'));
const U_END = fmt(moment().add(147, 'day'));
// A stay strictly inside the festival span.
const INSIDE_CHECKIN = fmt(moment().add(142, 'day'));
const INSIDE_CHECKOUT = fmt(moment().add(145, 'day'));
// A stay that wraps the whole festival (the legitimate split case).
const WRAP_CHECKIN = fmt(moment().add(138, 'day'));
const WRAP_CHECKOUT = fmt(moment().add(152, 'day'));
// A standalone closure with no utsav attached, for the day-visit case.
const CLOSURE_START = fmt(moment().add(160, 'day'));
const CLOSURE_END = fmt(moment().add(165, 'day'));
const CLOSURE_DAY = fmt(moment().add(162, 'day'));

let utsav;
let pkg;

describe('room stay inside an event span is blocked for everyone', () => {
  beforeAll(async () => {
    await sequelize.query('SET FOREIGN_KEY_CHECKS = 0');
    await RoomBooking.truncate();
    await sequelize.query('SET FOREIGN_KEY_CHECKS = 1');
    await CardFactory.create(ATTENDEE);
    await CardFactory.create(OUTSIDER);

    utsav = await UtsavDb.create({
      name: 'EVT_IN Utsav',
      start_date: U_START,
      end_date: U_END,
      month: moment(U_START).format('MMMM'),
      total_seats: 100,
      location: RESEARCH_CENTRE,
      available_seats: 100
    });
    pkg = await UtsavPackagesDb.create({
      utsavid: utsav.id,
      name: 'Full',
      start_date: U_START,
      end_date: U_END,
      amount: 0,
      updatedBy: 'test'
    });
    // The auto-block every utsav creates: checkin = start, checkout = end + 1.
    await BlockDates.create({
      checkin: U_START,
      checkout: fmt(moment(U_END).add(1, 'day')),
      comments: 'EVT_IN utsav auto-block',
      status: STATUS_ACTIVE,
      updatedBy: 'test'
    });
    await BlockDates.create({
      checkin: CLOSURE_START,
      checkout: CLOSURE_END,
      comments: 'EVT_IN plain closure',
      status: STATUS_ACTIVE,
      updatedBy: 'test'
    });
    // Only ATTENDEE holds a confirmed booking for the utsav.
    await UtsavBooking.create({
      bookingid: 'EVT_IN_UB_1',
      utsavid: utsav.id,
      cardno: ATTENDEE,
      packageid: pkg.id,
      arrival: 'own',
      status: STATUS_CONFIRMED,
      updatedBy: 'test'
    });
  });

  afterAll(async () => {
    await UtsavBooking.destroy({ where: { bookingid: 'EVT_IN_UB_1' } });
    await BlockDates.destroy({
      where: { comments: ['EVT_IN utsav auto-block', 'EVT_IN plain closure'] }
    });
    await UtsavPackagesDb.destroy({ where: { id: pkg.id } });
    await UtsavDb.destroy({ where: { id: utsav.id } });
    await CardDb.destroy({ where: { cardno: [ATTENDEE, OUTSIDER] } });
  });

  // Control: this already behaved correctly.
  it('non-attendee stay inside the event is rejected', async () => {
    const res = await postRoomValidate({
      cardno: OUTSIDER,
      primary_booking: roomBookingJson(OUTSIDER, INSIDE_CHECKIN, INSIDE_CHECKOUT)
    });
    expect(res.status).toBe(400);
  });

  // The bug: the attendee's split leaves zero ranges, so nothing was validated
  // and the stay slipped through as a silent success.
  it('attendee stay inside the event is rejected too', async () => {
    const res = await postRoomValidate({
      cardno: ATTENDEE,
      primary_booking: roomBookingJson(ATTENDEE, INSIDE_CHECKIN, INSIDE_CHECKOUT)
    });
    expect(res.status).toBe(400);
    // Names the festival the member is attending, not a centre closure.
    expect(JSON.stringify(res.body)).toEqual(expect.stringContaining(utsav.name));
  });

  // Booking the utsav and the room in ONE request resolves attendance from the
  // in-flight utsav rather than an existing booking. Same rule applies.
  it('rejects a room inside the event booked in the same request as the event', async () => {
    await expect(
      checkRoomAvailabilityForMumukshus(
        INSIDE_CHECKIN,
        INSIDE_CHECKOUT,
        [{ roomType: 'ac', floorType: '', mumukshus: [OUTSIDER] }],
        { cardno: OUTSIDER, credits: {} },
        utsav
      )
    ).rejects.toThrow(new RegExp(utsav.name));
  });

  // Second hole: a day visit skipped blocked-date validation entirely.
  it('day visit onto a blocked date is rejected', async () => {
    const res = await postRoomValidate({
      cardno: OUTSIDER,
      primary_booking: roomBookingJson(OUTSIDER, CLOSURE_DAY, CLOSURE_DAY)
    });
    expect(res.status).toBe(400);
  });

  // Regression guard: a stay that WRAPS the festival must still split into a
  // pre- and a post-festival segment (this change must not swallow the split).
  //
  // Not asserted through the endpoint on purpose: on this branch the post
  // segment starts on end_date, which is itself a blocked festival night, so the
  // endpoint rejects an attending member's wrapping stay. That is a separate,
  // pre-existing over-block, untouched here.
  it('a stay wrapping the event still produces pre- and post-festival ranges', () => {
    const ranges = splitDateRanges(U_START, U_END, WRAP_CHECKIN, WRAP_CHECKOUT);
    expect(ranges).toHaveLength(2);
    expect(ranges[0].start).toBe(WRAP_CHECKIN);
    expect(ranges[1].end).toBe(WRAP_CHECKOUT);
  });
});
