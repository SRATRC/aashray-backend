import request from 'supertest';
import { app, sequelize } from '../../../app.js';
import { Updates } from '../../../models/associations.js';
import {
  MSG_FETCH_SUCCESSFUL,
  TIER_OPTIONAL,
  TIER_REQUIRED,
  UPDATE_TYPE_NONE,
  UPDATE_TYPE_OPTIONAL,
  UPDATE_TYPE_FORCED,
  UPDATE_TYPE_UNSUPPORTED
} from '../../../config/constants.js';

// Seeds a release row for a platform.
const seed = (
  os,
  build,
  { version, min_os = null, tier = TIER_OPTIONAL } = {}
) =>
  Updates.create({
    os,
    build_number: build,
    version: version ?? `v${build}`,
    min_os,
    tier,
    mandatory: tier === TIER_REQUIRED,
    releaseNotes: `notes ${build}`
  });

describe('GET /api/v1/updates', () => {
  beforeEach(async () => {
    await Updates.truncate();
  });

  it('rejects an invalid/missing platform with 400', async () => {
    const res = await request(app)
      .get('/api/v1/updates')
      .set('x-platform', 'windows');
    expect(res.status).toBe(400);
  });

  it('returns 404 when there is no version info for the platform', async () => {
    const res = await request(app)
      .get('/api/v1/updates')
      .set('x-platform', 'ios');
    expect(res.status).toBe(404);
  });

  it('returns the legacy shape when compat headers are absent', async () => {
    await seed('android', 100, { version: '2.0.0' });
    await seed('android', 110, { version: '2.1.0', tier: TIER_REQUIRED });

    const res = await request(app).get('/api/v1/updates?os=android');
    expect(res.status).toBe(200);
    expect(res.body.message).toBe(MSG_FETCH_SUCCESSFUL);
    expect(res.body.data.latestVersion).toBe('2.1.0');
    expect(res.body.data.mandatory).toBe(true); // derived from latest row's tier
    // No server decision was made.
    expect(res.body.data.updateType).toBeUndefined();
  });

  it('falls back to legacy when x-os-version is malformed (never forces blindly)', async () => {
    await seed('android', 100);
    await seed('android', 120, { tier: TIER_REQUIRED });

    const res = await request(app)
      .get('/api/v1/updates')
      .set('x-platform', 'android')
      .set('x-app-build', '100')
      .set('x-os-version', 'unknown');

    expect(res.status).toBe(200);
    expect(res.body.data.updateType).toBeUndefined();
  });

  it('returns none when on the latest build', async () => {
    await seed('ios', 100);
    const res = await request(app)
      .get('/api/v1/updates')
      .set('x-platform', 'ios')
      .set('x-app-build', '100')
      .set('x-os-version', '16');
    expect(res.body.data.updateType).toBe(UPDATE_TYPE_NONE);
  });

  it('returns optional when a newer installable build exists but none required', async () => {
    await seed('ios', 100);
    await seed('ios', 110, { version: '2.5.0' });
    const res = await request(app)
      .get('/api/v1/updates')
      .set('x-platform', 'ios')
      .set('x-app-build', '100')
      .set('x-os-version', '16');
    expect(res.body.data.updateType).toBe(UPDATE_TYPE_OPTIONAL);
    expect(res.body.data.targetBuild).toBe(110);
  });

  it('forces to the newest installable build the device can reach', async () => {
    await seed('android', 100);
    await seed('android', 120, { tier: TIER_REQUIRED, min_os: '14' });
    const res = await request(app)
      .get('/api/v1/updates')
      .set('x-platform', 'android')
      .set('x-app-build', '100')
      .set('x-os-version', '15');
    expect(res.body.data.updateType).toBe(UPDATE_TYPE_FORCED);
    expect(res.body.data.targetBuild).toBe(120);
  });

  it('returns unsupported (no store dead-end) when device OS is below the required floor', async () => {
    await seed('android', 100, { min_os: '13' });
    await seed('android', 120, { tier: TIER_REQUIRED, min_os: '17' });
    const res = await request(app)
      .get('/api/v1/updates')
      .set('x-platform', 'android')
      .set('x-app-build', '100')
      .set('x-os-version', '15'); // can't install 120
    expect(res.body.data.updateType).toBe(UPDATE_TYPE_UNSUPPORTED);
    expect(res.body.data.targetBuild).toBe(100); // newest installable, never the un-installable build
  });

  it('treats NULL min_os as installable by everyone', async () => {
    await seed('android', 100);
    await seed('android', 110, { min_os: null, tier: TIER_REQUIRED });
    const res = await request(app)
      .get('/api/v1/updates')
      .set('x-platform', 'android')
      .set('x-app-build', '100')
      .set('x-os-version', '9'); // ancient, but no floor
    expect(res.body.data.updateType).toBe(UPDATE_TYPE_FORCED);
    expect(res.body.data.targetBuild).toBe(110);
  });

  it('anchors force on the highest required build with multiple required releases', async () => {
    await seed('ios', 100);
    await seed('ios', 110, { tier: TIER_REQUIRED });
    await seed('ios', 130, { tier: TIER_REQUIRED });
    const res = await request(app)
      .get('/api/v1/updates')
      .set('x-platform', 'ios')
      .set('x-app-build', '120') // above 110, below 130
      .set('x-os-version', '16');
    expect(res.body.data.updateType).toBe(UPDATE_TYPE_FORCED);
    expect(res.body.data.targetBuild).toBe(130);
  });
});
