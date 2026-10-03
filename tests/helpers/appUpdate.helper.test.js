import { decideUpdate } from '../../helpers/appUpdate.helper.js';

// Each case is one way the update decision can hurt a member: locking them
// out with an update their phone can't install, or failing to force a fix.

const rel = (version, min_os, mandatory, releaseNotes = null) => ({
  version,
  min_os,
  mandatory,
  releaseNotes
});

// iOS: 1.1.60 is mandatory but raised the minimum OS to 16.4.
const ladder = [
  rel('1.1.50', '15.1', true, 'notes 50'),
  rel('1.1.55', '15.1', false, 'notes 55'),
  rel('1.1.60', '16.4', true, 'notes 60')
];

// prettier-ignore
test.each([
  // [case, rows, app version, OS version, expected updateType, expected target]
  ['mandatory build needs a newer OS: never forced', ladder, '1.1.55', '15.8', 'unsupported', '1.1.55'],
  ['mandatory build the phone can install: forced', ladder, '1.1.52', '17.0', 'forced', '1.1.60'],
  ['newer optional release keeps an older mandatory one', [rel('1.1.50', '26', true), rel('1.1.59', '26', false)], '1.1.45', '30', 'forced', '1.1.59'],
  ['newer mandatory release on a higher OS keeps an older reachable one', ladder, '1.1.45', '15.8', 'forced', '1.1.55'],
  ['up to date: nothing to do', ladder, '1.1.60', '17.0', 'none', '1.1.60'],
  ['ahead of the table (test build): nothing to do', ladder, '1.2.0', '17.0', 'none', '1.1.60'],
  ['1.1.100 is newer than 1.1.60, not older', ladder, '1.1.100', '17.0', 'none', '1.1.60'],
  ['iOS 10 is newer than iOS 9, not older', [rel('2.0.0', '9.0', true)], '1.0.0', '10.0', 'forced', '2.0.0'],
  ['typo in minimum OS counts as not installable', [rel('1.1.55', null, false), rel('1.1.60', 'abc', true)], '1.1.50', '17.0', 'unsupported', '1.1.55'],
  ['rows in any order give the same answer', [...ladder].reverse(), '1.1.52', '17.0', 'forced', '1.1.60'],
  ['offers the newest build this OS can install, not the newest overall', [rel('1.1.55', '15.1', false), rel('1.1.60', '16.4', false)], '1.1.52', '15.8', 'optional', '1.1.55'],
  ['no release rows: nothing to do', [], '1.1.50', '17.0', 'none', null],
  ['nothing installable on this OS: notice, no target', [rel('1.1.60', '99', true)], '1.1.50', '17.0', 'unsupported', null],
  ['blank minimum OS means everyone can install', [rel('1.1.60', null, true)], '1.1.50', '12.0', 'forced', '1.1.60'],
  ['a row with a broken version is ignored', [rel('abc', null, true), rel('1.1.60', null, false)], '1.1.50', '17.0', 'optional', '1.1.60']
])('%s', (_, rows, appVersion, osVersion, updateType, targetVersion) => {
  expect(decideUpdate(rows, appVersion, osVersion)).toMatchObject({
    updateType,
    targetVersion
  });
});

test('release notes come from the build the phone is sent to', () => {
  expect(decideUpdate(ladder, '1.1.52', '15.8').targetReleaseNotes).toBe(
    'notes 55'
  );
});
