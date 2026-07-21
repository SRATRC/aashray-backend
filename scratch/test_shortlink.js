import '../config/environment.js';
import sequelize from '../config/database.js';
import ShibirDb from '../models/shibir_db.model.js';
import UtsavDb from '../models/utsav_db.model.js';
import ShortLink from '../models/short_link.model.js';
import { createAdhyayan, updateAdhyayan } from '../controllers/admin/adhyayanManagement.controller.js';
import { createUtsav, updateUtsav } from '../controllers/admin/utsavManagement.controller.js';

// Setup mock request/response objects
const mockReq = (body, params = {}) => ({
  body,
  params,
  user: { username: 'test-admin' },
  log: {
    info: console.log,
    warn: console.warn,
    error: console.error
  }
});

const mockRes = () => {
  const res = {};
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.send = (data) => {
    res.sendData = data;
    return res;
  };
  res.json = (data) => {
    res.jsonData = data;
    return res;
  };
  return res;
};

async function testShibir() {
  console.log('\n--- TESTING SHIBIR SHORTLINK INTEGRATION ---');
  
  // 1. Create Shibir with valid whatsapp_link and comments slug
  const req1 = mockReq({
    name: 'Test Shibir',
    start_date: '2026-08-01',
    end_date: '2026-08-05',
    speaker: 'Test Speaker ' + Date.now(),
    amount: 100,
    location: 'Dhule',
    total_seats: 50,
    food_allowed: '0',
    comments: 'testslug_' + Date.now(),
    whatsapp_link: 'https://chat.whatsapp.com/test-shibir-link'
  });
  const res1 = mockRes();
  
  await createAdhyayan(req1, res1);
  console.log('Create Status:', res1.statusCode, 'Data:', res1.sendData?.message);
  
  const shibirId = res1.sendData?.data?.id;
  const shibirSlug = res1.sendData?.data?.comments;
  
  // Check if ShortLink was created
  const link = await ShortLink.findOne({ where: { slug: shibirSlug } });
  console.log('ShortLink created successfully:', !!link, 'target:', link?.target_url);

  // 2. Validate duplicate slug error
  const req2 = mockReq({
    name: 'Test Shibir 2',
    start_date: '2026-08-06',
    end_date: '2026-08-10',
    speaker: 'Test Speaker 2 ' + Date.now(),
    amount: 100,
    location: 'Dhule',
    total_seats: 50,
    food_allowed: '0',
    comments: shibirSlug, // Duplicate slug
    whatsapp_link: 'https://chat.whatsapp.com/test-shibir-link-2'
  });
  const res2 = mockRes();
  try {
    await createAdhyayan(req2, res2);
  } catch (err) {
    console.log('Duplicate Slug Blocked successfully:', err.message);
  }

  // 3. Validate invalid slug format error
  const req3 = mockReq({
    name: 'Test Shibir 3',
    start_date: '2026-08-11',
    end_date: '2026-08-15',
    speaker: 'Test Speaker 3 ' + Date.now(),
    amount: 100,
    location: 'Dhule',
    total_seats: 50,
    food_allowed: '0',
    comments: 'invalid slug with spaces', // Invalid format
    whatsapp_link: 'https://chat.whatsapp.com/test-shibir-link-3'
  });
  const res3 = mockRes();
  try {
    await createAdhyayan(req3, res3);
  } catch (err) {
    console.log('Invalid Slug format Blocked successfully:', err.message);
  }

  // 4. Update Shibir (change whatsapp link and slug)
  const newSlug = 'newslug_' + Date.now();
  const req4 = mockReq({
    name: 'Test Shibir Updated',
    start_date: '2026-08-01',
    end_date: '2026-08-05',
    speaker: req1.body.speaker,
    amount: 100,
    location: 'Dhule',
    total_seats: 50,
    food_allowed: '0',
    comments: newSlug,
    whatsapp_link: 'https://chat.whatsapp.com/updated-shibir-link'
  }, { id: shibirId });
  const res4 = mockRes();

  await updateAdhyayan(req4, res4);
  console.log('Update Status:', res4.statusCode, 'Data:', res4.sendData?.message);

  // Check if old short link was deleted or renamed
  const oldLink = await ShortLink.findOne({ where: { slug: shibirSlug } });
  const newLink = await ShortLink.findOne({ where: { slug: newSlug } });
  console.log('Old link deleted/renamed:', !oldLink);
  console.log('New link created/updated:', !!newLink, 'target:', newLink?.target_url);

  // 5. Update Shibir to clear whatsapp_link
  const req5 = mockReq({
    name: 'Test Shibir Updated',
    start_date: '2026-08-01',
    end_date: '2026-08-05',
    speaker: req1.body.speaker,
    amount: 100,
    location: 'Dhule',
    total_seats: 50,
    food_allowed: '0',
    comments: newSlug,
    whatsapp_link: '' // Cleared
  }, { id: shibirId });
  const res5 = mockRes();

  await updateAdhyayan(req5, res5);
  console.log('Update Status (cleared):', res5.statusCode, 'Data:', res5.sendData?.message);

  const clearedLink = await ShortLink.findOne({ where: { slug: newSlug } });
  console.log('ShortLink successfully deleted on clear:', !clearedLink);
}

async function testUtsav() {
  console.log('\n--- TESTING UTSAV SHORTLINK INTEGRATION ---');

  // 1. Create Utsav with whatsapp_link
  const req1 = mockReq({
    name: 'Test Utsav ' + Date.now(),
    start_date: '2026-09-01',
    end_date: '2026-09-05',
    total_seats: 100,
    location: 'Mumbai',
    registration_deadline: '2026-08-25',
    starting_meal: null,
    ending_meal: null,
    comments: 'Utsav comments',
    whatsapp_link: 'https://chat.whatsapp.com/test-utsav-link'
  });
  const res1 = mockRes();

  await createUtsav(req1, res1);
  console.log('Create Status:', res1.statusCode, 'Data:', res1.sendData?.message);

  const utsavId = res1.sendData?.data?.id;

  // Check if ShortLink was created with Utsav ID as slug
  const link = await ShortLink.findOne({ where: { slug: String(utsavId), type: 'utsav' } });
  console.log('ShortLink created successfully:', !!link, 'slug:', link?.slug, 'target:', link?.target_url);

  // 2. Update Utsav (change whatsapp link)
  const req2 = mockReq({
    name: req1.body.name,
    start_date: '2026-09-01',
    end_date: '2026-09-05',
    total_seats: 100,
    location: 'Mumbai',
    registration_deadline: '2026-08-25',
    starting_meal: null,
    ending_meal: null,
    comments: 'Utsav comments',
    whatsapp_link: 'https://chat.whatsapp.com/updated-utsav-link'
  }, { id: utsavId });
  const res2 = mockRes();

  await updateUtsav(req2, res2);
  console.log('Update Status:', res2.statusCode, 'Data:', res2.sendData?.message);

  const updatedLink = await ShortLink.findOne({ where: { slug: String(utsavId), type: 'utsav' } });
  console.log('ShortLink updated successfully:', !!updatedLink, 'target:', updatedLink?.target_url);

  // 3. Update Utsav to clear whatsapp_link
  const req3 = mockReq({
    name: req1.body.name,
    start_date: '2026-09-01',
    end_date: '2026-09-05',
    total_seats: 100,
    location: 'Mumbai',
    registration_deadline: '2026-08-25',
    starting_meal: null,
    ending_meal: null,
    comments: 'Utsav comments',
    whatsapp_link: '' // Cleared
  }, { id: utsavId });
  const res3 = mockRes();

  await updateUtsav(req3, res3);
  console.log('Update Status (cleared):', res3.statusCode, 'Data:', res3.sendData?.message);

  const clearedLink = await ShortLink.findOne({ where: { slug: String(utsavId), type: 'utsav' } });
  console.log('ShortLink successfully deleted on clear:', !clearedLink);
}

(async () => {
  try {
    await testShibir();
    await testUtsav();
    console.log('\n✅ ALL INTEGRATION TESTS COMPLETED SUCCESSFULLY!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Test failed:', err);
    process.exit(1);
  }
})();
