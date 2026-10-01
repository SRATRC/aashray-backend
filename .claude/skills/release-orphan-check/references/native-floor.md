# Reading the app's OS floor

The OS floor is the lowest OS that can **install** the build. The app uses Expo
prebuild: `ios/` and `android/` are generated and gitignored, never in a diff,
and a local copy may come from another branch. Read from git at a commit
(`git -C ../aashray-app show <commit>:app.config.js`), not from the working tree.

## Where the floor comes from

| Platform | Set by (first match wins) | If not set |
|---|---|---|
| Android | the `expo-build-properties` plugin's `android.minSdkVersion` | not in the Expo template; if neither is set, stop and ask (don't guess) |
| iOS | `expo.ios.deploymentTarget`, then the `expo-build-properties` plugin's `ios.deploymentTarget` (deprecated since SDK 56) | the Expo SDK default |

The SDK is the `expo` entry in `package.json` at that commit. A native library
that needs a higher OS can't raise the floor silently: the build fails
(CocoaPods "required a higher minimum deployment target", or Android's manifest
merger) until one of the values above is raised. So these two files are the
whole truth.

## SDK default iOS floor (read-only, no prebuild)

```bash
T=$(npm view expo-template-bare-minimum@sdk-<N> dist.tarball)
curl -sL "$T" | tar -xzOf - package/ios/Podfile | grep "platform :ios"
# platform :ios, podfile_properties['ios.deploymentTarget'] || '16.4'
```

`<N>` is the SDK major version. The value after `||` is the default (16.4 for
SDK 56 and 57). If you see a different value, cross-check
`package/ios/HelloWorld.xcodeproj/project.pbxproj` (`IPHONEOS_DEPLOYMENT_TARGET`).

## Units

- iOS: version string (`"16.4"`).
- Android: **API level** (`"26"`), same number as `minSdkVersion`. Store it
  as-is in `updates.min_os`.

Compare numerically, segment by segment (`"10" > "9"`), as in
`utils/versionCompare.js`.
