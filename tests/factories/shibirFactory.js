import { ShibirDb } from '../../models/associations.js';

class ShibirFactory {
  static async create() {
    const shibirDetails = {
      id: 1,
      name: 'Sample Shibir',
      month: new Date().getMonth(),
      start_date: new Date(),
      end_date: new Date(Date.now() + 2 * 86400000),
      description: 'Sample Shibir description',
      location: 'RC',
      speaker: 'Premal Bhai',
      total_seats: 20,
      available_seats: 20,
      amount: 199,
      seats_booked: 0,
      status: 'open',
      updatedBy: 'admin'
    };

    return await ShibirDb.create(shibirDetails);
  }
}

export default ShibirFactory;
