# Reading the native OS floor

The OS floor is the minimum OS a device needs to **install** the build. It lives in
native config, and a transitive library bump can raise it silently — so always
check native truth first, then Expo config, then the SDK default.

## Priority order

### 1. Native project files (highest authority)

**iOS — `ios/Podfile.lock`, `ios/Podfile`, and the Xcode project**
- `Podfile` / `Podfile.lock`: look for `platform :ios, 'X.Y'` and pod entries whose
  own minimum deployment target is higher than the app's.
- `ios/<App>.xcodeproj/project.pbxproj`: `IPHONEOS_DEPLOYMENT_TARGET`.
- The **effective iOS floor** is the max of the app target and every pod's minimum.

**Android — `android/app/build.gradle`, `android/build.gradle`, `gradle.properties`**
- `minSdkVersion` (or `minSdk`) in `android/app/build.gradle` `defaultConfig`.
- Sometimes set via `rootProject.ext.minSdkVersion` in `android/build.gradle` or
  `minSdkVersion=` in `gradle.properties`.
- A library's `minSdkVersion` in its manifest can force the app's up during merge —
  check release notes of any bumped dependency.

### 2. Expo config — `app.config.js` / `app.json`
- `ios.deploymentTarget`, `android.minSdkVersion`, and any `expo-build-properties`
  config plugin that sets `deploymentTarget` / `minSdkVersion`.
- On managed/prebuild flows these values generate the native files above.

### 3. Expo SDK default (lowest authority, the fallback)
- If nothing overrides it, the floor is the pinned Expo SDK's default deployment
  target / minSdk. Determine the SDK version from `package.json` (`expo` dependency)
  and use that SDK's documented defaults.

## Detecting a *bump*

Compare the effective new floor to the previous release's floor:
- Diff the native files against the base branch (`git diff <base>...HEAD -- ios android app.config.js app.json`).
- Cross-check against the DB: the `min_os` of the current latest `updates` row per
  platform is what we last told clients (see `mcp-queries.md`). A new floor **above**
  that `min_os` is an orphaning bump.

## Version comparison rule

Always compare OS/marketing versions **numerically, segment by segment** — never as
strings. `"10"` is greater than `"4"`, but a string compare says the opposite. The
backend's `utils/versionCompare.js` is the reference implementation; mirror its
behavior (split on `.`, compare integer segments, missing segment = 0).

## Android minSdk → marketing version

`min_os` in the model is the Android **marketing version** string, not the API
level. Map the API level to its marketing version when reporting the floor, e.g.:

| minSdk (API) | Android marketing version |
|--------------|---------------------------|
| 24           | 7.0                       |
| 26           | 8.0                       |
| 28           | 9                         |
| 29           | 10                        |
| 30           | 11                        |
| 31 / 32      | 12                        |
| 33           | 13                        |
| 34           | 14                        |
| 35           | 15                        |

(Play Store gates installation by API level; we store the marketing version because
it is what humans and the client's `x-os-version` report. Ordering is preserved.)
