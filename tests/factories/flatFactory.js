import { FlatDb } from '../../models/associations.js';

class FlatFactory {
  static async create(owner, flatno = 101) {
    const flatDetails = {
      flatno,
      owner,
      updatedBy: 'admin'
    };

    return await FlatDb.create(flatDetails);
  }
}

export default FlatFactory;
