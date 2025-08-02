import { faker } from '@faker-js/faker';
import { UtsavDb } from '../../models/associations.js';
import { STATUS_OPEN } from '../../config/constants.js';

class UtsavFactory {
  static async create(startDate, endDate) {
    return UtsavDb.create({
      name: "Test Utsav",
      start_date: startDate,
      end_date: endDate,
      month: new Date(startDate).getMonth(),
      total_seats: 400,
      location: 'Research Centre',
      available_seats: 100
    });
  }
}

export default UtsavFactory;

