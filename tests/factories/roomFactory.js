import { ROOM_STATUS_AVAILABLE } from '../../config/constants.js';
import { RoomDb } from '../../models/associations.js';

class RoomFactory {
  static async create() {
    const roomDetails = {
      roomno: '1A',
      roomtype: 'ac',
      gender: 'M',
      roomstatus: ROOM_STATUS_AVAILABLE,
      updatedBy: 'admin'
    };

    return await RoomDb.create(roomDetails);
  }

  static async createRoomFor1DayVisit() {
    const roomDetails = {
        roomno: 'NA',
        roomtype: 'NA',
        gender: 'NA',
        roomstatus: ROOM_STATUS_AVAILABLE,
        updatedBy: 'admin'
    }

    return await RoomDb.create(roomDetails);
  }
}

export default RoomFactory;

