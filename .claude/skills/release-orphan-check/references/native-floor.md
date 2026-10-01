# Reading the app's OS floor

The OS floor is the lowest OS that can **install** the build. The app uses Expo
prebuild: `ios/` and `android/` are generated and gitignored, so they never show
in a diff and a local copy can be stale.

## Where the floor comes from (in `../aashray-app`)

| Platform | Set by | If not set |
|---|---|---|
| Android | `app.config.js` → `expo-build-properties` → `android.minSdkVersion` | the Expo SDK default |
| iOS | `app.config.js` → `expo-build-properties` → `ios.deploymentTarget` | the Expo SDK default, written into the generated `ios/Podfile` as `platform :ios, podfile_properties['ios.deploymentTarget'] \|\| 'X'` |

The SDK version is the `expo` entry in `package.json`. An SDK bump can raise
both defaults, so treat every SDK bump as a possible floor bump.

## Detecting a bump

```bash
git -C ../aashray-app diff <base>...HEAD -- app.config.js package.json
```

Look for a changed `minSdkVersion` or `deploymentTarget`, or a changed `expo`
version. For an SDK bump with no `deploymentTarget` set, get the new iOS default
by regenerating: `npx expo prebuild --platform ios --no-install` in a scratch copy
of the app, then read the Podfile line above.

A native library that needs a higher OS can't raise the floor silently. The
build fails (CocoaPods "required a higher minimum deployment target", or the
Android manifest merger's minSdkVersion error) until someone raises one of the
values above. So the diff above catches every bump.

## Units

- iOS: version string (`"16.4"`).
- Android: **API level** (`"26"`), the same number as `minSdkVersion`. Store it
  as-is in `updates.min_os`; no mapping to Android version names.

Compare numerically, segment by segment (`"10" > "4"`), as in
`utils/versionCompare.js`.
