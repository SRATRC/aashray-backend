import { decideUpdate } from '../../helpers/appUpdate.helper.js';
import {
  UPDATE_TYPE_NONE,
  UPDATE_TYPE_OPTIONAL,
  UPDATE_TYPE_FORCED,
  UPDATE_TYPE_UNSUPPORTED,
  TIER_OPTIONAL,
  TIER_REQUIRED
} from '../../config/constants.js';

// Helper to build a release row. Rows must be passed to decideUpdate sorted by
// build_number DESC (newest first), matching the controller's query order.
const rel = (build, { version, min_os = null, tier = TIER_OPTIONAL } = {}) => ({
  build_number: build,
  version: version ?? `v${build}`,
  min_os,
  tier
});
const desc = (...rows) =>
  [...rows].sort((a, b) => b.build_number - a.build_number);

describe('decideUpdate (OS-ladder)', () => {
  it('returns none when the client is already on the latest build', () => {
    const rows = desc(rel(100), rel(90));
    const d = decideUpdate(rows, 100, '16');
    expect(d.updateType).toBe(UPDATE_TYPE_NONE);
  });

  it('returns none when the client is ahead of the store (beta/sideload)', () => {
    const rows = desc(rel(100), rel(90));
    const d = decideUpdate(rows, 130, '16');
    expect(d.updateType).toBe(UPDATE_TYPE_NONE);
  });

  it('returns optional when a newer installable build exists but none required', () => {
    const rows = desc(rel(110, { version: '2.5.0' }), rel(100));
    const d = decideUpdate(rows, 100, '16');
    expect(d.updateType).toBe(UPDATE_TYPE_OPTIONAL);
    expect(d.targetBuild).toBe(110);
    expect(d.targetVersion).toBe('2.5.0');
  });

  it('forces to the newest installable build when a reachable required release exists', () => {
    const rows = desc(
      rel(120, { tier: TIER_REQUIRED, min_os: '14' }),
      rel(100)
    );
    const d = decideUpdate(rows, 100, '15'); // device OS 15 >= floor 14
    expect(d.updateType).toBe(UPDATE_TYPE_FORCED);
    expect(d.targetBuild).toBe(120);
  });

  it('never forces past the OS ladder: forced target is the newest INSTALLABLE build', () => {
    // 130 requires OS 17 (unreachable), 120 is required and needs OS 14 (reachable).
    const rows = desc(
      rel(130, { tier: TIER_OPTIONAL, min_os: '17' }),
      rel(120, { tier: TIER_REQUIRED, min_os: '14' }),
      rel(100)
    );
    const d = decideUpdate(rows, 100, '16'); // can install up to 120, not 130
    expect(d.updateType).toBe(UPDATE_TYPE_FORCED);
    expect(d.targetBuild).toBe(120); // not 130
  });

  it('returns unsupported (no dead-end) when the device cannot reach the required fix', () => {
    // Required fix is build 120 needing OS 17; device is on OS 15 → cannot install it.
    const rows = desc(
      rel(120, { tier: TIER_REQUIRED, min_os: '17' }),
      rel(100, { min_os: '13' })
    );
    const d = decideUpdate(rows, 100, '15');
    expect(d.updateType).toBe(UPDATE_TYPE_UNSUPPORTED);
    // Target is the newest build the device CAN install (its current one), never a build it can't.
    expect(d.targetBuild).toBe(100);
  });

  it('returns unsupported with null target when no build is installable at all', () => {
    const rows = desc(
      rel(120, { tier: TIER_REQUIRED, min_os: '17' }),
      rel(100, { min_os: '16' })
    );
    const d = decideUpdate(rows, 90, '15'); // can install nothing
    expect(d.updateType).toBe(UPDATE_TYPE_UNSUPPORTED);
    expect(d.targetBuild).toBeNull();
    expect(d.targetVersion).toBeNull();
  });

  it('treats NULL min_os as installable by everyone', () => {
    const rows = desc(
      rel(110, { min_os: null, tier: TIER_REQUIRED }),
      rel(100)
    );
    const d = decideUpdate(rows, 100, '9'); // ancient OS, but no floor
    expect(d.updateType).toBe(UPDATE_TYPE_FORCED);
    expect(d.targetBuild).toBe(110);
  });

  it('anchors force on the HIGHEST required build across multiple required releases', () => {
    // Both 110 and 130 are required; the binding floor is 130.
    const rows = desc(
      rel(130, { tier: TIER_REQUIRED }),
      rel(110, { tier: TIER_REQUIRED }),
      rel(100)
    );
    // Client at 120 is above the older required (110) but below the newest (130) → forced.
    const d = decideUpdate(rows, 120, '16');
    expect(d.updateType).toBe(UPDATE_TYPE_FORCED);
    expect(d.targetBuild).toBe(130);
  });

  it('exposes the latest build OS floor as minOsVersion for messaging', () => {
    const rows = desc(rel(120, { min_os: '17.0' }), rel(100));
    const d = decideUpdate(rows, 100, '16');
    expect(d.minOsVersion).toBe('17.0');
  });
});
