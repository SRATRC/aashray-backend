import {
  STATUS_GUEST,
  STATUS_MUMUKSHU,
  STATUS_OFFPREM
} from '../../config/constants.js';
import { CardDb } from '../../models/associations.js';
import { faker } from '@faker-js/faker';

class CardFactory {
  static async create(cardno) {
    return await CardFactory._create(cardno, STATUS_MUMUKSHU);
  }

  static async createGuest(cardno) {
    return await CardFactory._create(cardno, STATUS_GUEST);
  }

  static async _create(cardno, res_status, mobno) {
    const cardDetails = {
      cardno,
      res_status,
      mobno: faker.number.bigInt({max: 10000000000, min: 1000000000}),
      issuedto: faker.person.fullName(),
      gender: 'M',
      dob: faker.date.birthdate(),
      email: 'test@example.com',
      idType: 'AADHAR',
      idNo: '123456789012',
      address: 'Test Address',
      country: 'India',
      state: 'Maharashtra',
      city: 'Pune',
      pin: '411001',
      centre: 'Pune',
      status: STATUS_OFFPREM,
      updatedBy: 'admin'
    };

    try {
      return await CardDb.create(cardDetails);
    } catch(error) {
      console.log(error);
    }
  }
}

export default CardFactory;
