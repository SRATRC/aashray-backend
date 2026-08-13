import { expect, it, describe, mock } from "bun:test";
import {
  TYPE_ROOM,
  TYPE_FLAT,
  TYPE_ADHYAYAN,
  TYPE_FOOD,
  TYPE_TRAVEL,
  TYPE_UTSAV
} from '../config/constants.js';

mock.module("../models/associations.js", () => ({
  RoomBooking: { findAll: async (q) => q.where.bookingid.map(id => ({ bookingid: id })) },
  FlatBooking: { findAll: async (q) => q.where.bookingid.map(id => ({ bookingid: id })) },
  ShibirBookingDb: { findAll: async (q) => q.where.bookingid.map(id => ({ bookingid: id })) },
  FoodDb: { findAll: async (q) => q.where.id.map(id => ({ id })) },
  TravelDb: { findAll: async (q) => q.where.bookingid.map(id => ({ bookingid: id })) },
  UtsavBooking: { findAll: async (q) => q.where.bookingid.map(id => ({ bookingid: id })) },
  CardDb: {},
  Transactions: {},
  ShibirDb: {},
  Departments: {},
  MaintenanceDb: {},
  GateRecord: {},
  CentreDb: {},
  BulkFoodBooking: {},
  FoodPhysicalPlate: {},
  RoomDb: {},
  FlatDb: {},
  UtsavDb: {},
  UtsavPackagesDb: {},
  AdminRoles: {},
  AdminUsers: {},
  Roles: {},
  Menu: {},
  Cities: {},
  States: {},
  Countries: {},
  GuestDb: {},
  GuestRelationship: {},
  RazorpayWebhook: {},
  RazorpaySettlement: {},
  SupportTickets: {},
  BlockDates: {},
  Updates: {},
  AdhyayanFeedback: {},
  RazorpaySettlementRecon: {},
  ShibirAttendanceDb: {}
}));

const { getBookings } = await import('../helpers/booking.helper.js');

describe('getBookings', () => {
  it('should return empty array for empty bookingids', async () => {
    const result = await getBookings(TYPE_ROOM, []);
    expect(result).toEqual([]);
  });

  it('should call RoomBooking.findAll for TYPE_ROOM', async () => {
    const ids = ['room1'];
    const result = await getBookings(TYPE_ROOM, ids);
    expect(result).toHaveLength(1);
    expect(result[0].bookingid).toBe('room1');
  });

  it('should call FoodDb.findAll for TYPE_FOOD', async () => {
    const ids = [1];
    const result = await getBookings(TYPE_FOOD, ids);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(1);
  });

  it('should throw error for invalid booking type', async () => {
    try {
        await getBookings('INVALID', ['id1']);
        expect(true).toBe(false); // Should not reach here
    } catch (e) {
        expect(e.message).toContain('Invalid booking type');
    }
  });
});
