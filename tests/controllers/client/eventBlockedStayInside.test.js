// Blocked dates during an event must reject EVERYONE, attendee or not.
//
// Production bug: a member who booked the utsav could request a room stay that
// falls entirely inside the utsav's blocked span and the API accepted it, while
// the same request from a non-attendee was correctly rejected.
//
// Root cause: the attended-utsav split removes the festival days from the stay.
// When the whole requested stay sits inside the festival, the split yields ZERO
// ranges, and the blocked-date validation runs over that empty list — so nothing
// is ever checked and nothing is ever rejected.
//
// Locked rule: "blocked = unavailable, never bookable; attended-utsav → split →
// bookable". A stay with no bookable night left after the split is a reject.
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
const WRAP_CHECKOUT = fmt(moment().add(150, 'day'));

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
    // Delete children by their foreign key, not by the one seeded bookingid:
    // the requests under test can create further rows against this utsav, and
    // any survivor makes the UtsavDb delete below fail on a foreign key. The
    // suite then reports "Test suite failed to run" and, because every suite
    // shares one database, leaves its fixtures behind for whatever runs next.
    await UtsavBooking.destroy({ where: { utsavid: utsav.id } });
    await BlockDates.destroy({ where: { comments: 'EVT_IN utsav auto-block' } });
    await UtsavPackagesDb.destroy({ where: { utsavid: utsav.id } });
    await UtsavDb.destroy({ where: { id: utsav.id } });
    await CardDb.destroy({ where: { cardno: [ATTENDEE, OUTSIDER] } });
  });

  // Control: this already behaves correctly today.
  it('non-attendee stay inside the event is rejected', async () => {
    const res = await postRoomValidate({
      cardno: OUTSIDER,
      primary_booking: roomBookingJson(OUTSIDER, INSIDE_CHECKIN, INSIDE_CHECKOUT)
    });
    expect(res.status).toBe(200);
    expect(res.body.data.roomDetails.length).toBeGreaterThan(0);
    expect(res.body.data.roomDetails.every((r) => r.isBlocked)).toBe(true);
  });

  // The bug: the attendee's split leaves zero ranges, so nothing is validated
  // and the stay slips through as a silent success.
  it('attendee stay inside the event is rejected too', async () => {
    const res = await postRoomValidate({
      cardno: ATTENDEE,
      primary_booking: roomBookingJson(ATTENDEE, INSIDE_CHECKIN, INSIDE_CHECKOUT)
    });
    expect(res.status).toBe(200);
    // Never an empty, silently-accepted stay.
    expect(res.body.data.roomDetails.length).toBeGreaterThan(0);
    expect(res.body.data.roomDetails.every((r) => r.isBlocked)).toBe(true);
    expect(res.body.data.totalCharge).toBe(0);
  });

  // The write path must hard-reject, not merely flag it for the preview.
  it('the booking write path throws for an attendee stay inside the event', async () => {
    await expect(
      checkRoomAvailabilityForMumukshus(
        INSIDE_CHECKIN,
        INSIDE_CHECKOUT,
        [{ roomType: 'ac', floorType: '', mumukshus: [ATTENDEE] }],
        { cardno: ATTENDEE, credits: {} },
        null
      )
    ).rejects.toThrow(new RegExp(`cannot be booked|${utsav.name}`));
  });

  // Booking the utsav and the room in ONE request resolves attendance from the
  // in-flight utsav rather than an existing booking. Same rule applies: the room
  // half covers only festival nights, so the whole request is refused.
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

  // The refusal must not call the member's own festival a centre closure — the
  // blocked-dates calendar tells them those nights are part of the utsav.
  it('names the utsav, not a centre closure, when refusing', async () => {
    const res = await postRoomValidate({
      cardno: ATTENDEE,
      primary_booking: roomBookingJson(ATTENDEE, INSIDE_CHECKIN, INSIDE_CHECKOUT)
    });
    const blocked = res.body.data.roomDetails.find((r) => r.isBlocked);
    expect(blocked.unavailableReason).toEqual(expect.stringContaining(utsav.name));
    expect(blocked.unavailableReason).not.toEqual(
      expect.stringContaining('centre is closed')
    );
  });

  // Regression guard: the legitimate split must keep working.
  it('attendee stay wrapping the event still splits into bookable ranges', async () => {
    const res = await postRoomValidate({
      cardno: ATTENDEE,
      primary_booking: roomBookingJson(ATTENDEE, WRAP_CHECKIN, WRAP_CHECKOUT)
    });
    expect(res.status).toBe(200);
    const details = res.body.data.roomDetails;
    expect(details.length).toBe(2); // pre-festival + post-festival
    expect(details.some((r) => r.isBlocked)).toBe(false);
    // The festival nights themselves are never part of a room range.
    for (const r of details) {
      expect(moment(r.range.end).isSameOrBefore(U_START) ||
        moment(r.range.start).isAfter(U_END)).toBe(true);
    }
  });
});
