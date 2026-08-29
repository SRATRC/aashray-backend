import { FlatDb } from '../../models/associations.js';

class FlatFactory {
  static async create(owner, flatno) {
    return await FlatDb.create({
      flatno,
      owner,
      updatedBy: 'admin'
    });
  }
}

export default FlatFactory;
