---
name: release-orphan-check
description: >-
  Pre-release check that finds users a release would strand, and the change that
  strands nobody. Looks for two things: a raised minimum OS (old phones can no
  longer install) and an API change old app versions can't handle. Use before
  shipping an app release, when bumping the Expo SDK / minSdkVersion /
  deploymentTarget, before marking a release mandatory, or when changing a client
  API response. Triggers on "ship a release", "will this strand users", "OS floor",
  "min sdk / deployment target bump", "force update", "breaking API change".
---

# Release Orphan Check

Before a release ships, find who it strands and how to avoid it. Read-only: you
recommend, you never write to the DB or edit release rows.

## How the update system works (what you are checking against)

- `updates` table, **one row per store release per platform**: `os`, `version`,
  `min_os`, `mandatory`, `releaseNotes`. `min_os` unit: iOS version (`"16.4"`),
  Android **API level** (`"26"`, same as `minSdkVersion`). NULL = everyone.
- The app sends `x-platform`, `x-app-version`, `x-os-version` on every request.
  The update check (`helpers/appUpdate.helper.js`) then returns, per device:
  `forced` (below the newest mandatory release and can install it), `unsupported`
  (below it but this OS can't install it: a dismissable notice, never a block),
  `optional`, or `none`.
- App builds older than this system send no headers and get the legacy answer:
  newest row's `version` + `mandatory`. For them, a mandatory row they can't
  install **is** a lockout. That is the one way this system can still strand users.
- `device_telemetry`: last-seen `app_version` + `os_version` per user and platform.

## Step 1: gather (in parallel)

1. **The change.** The plan text, or `git diff <base>...HEAD --stat` then the
   relevant files.
2. **The app's OS floor.** The app is a sibling repo (`../aashray-app` from the
   backend). Its `ios/` and `android/` folders are generated and gitignored, so the
   committed truth is only:
   - `app.config.js`, the `expo-build-properties` plugin: `android.minSdkVersion`,
     `ios.deploymentTarget`.
   - `package.json`: the `expo` SDK version. With no `ios.deploymentTarget`, the
     iOS floor is the SDK's default; read it from the generated `ios/Podfile`
     line `platform :ios, ... || 'X'`. A local `ios/` may be stale, so if the SDK
     changed, regenerate it first.
   A native library that needs a higher OS fails the build (pod install / manifest
   merge) until one of those two values is raised, so diffing these two files
   catches every floor bump. Details in `references/native-floor.md`.
3. **Live data** via the aashray MCP (prod, read-only): the release rows and the
   telemetry counts. Queries in `references/mcp-queries.md`.

## Step 2: the two checks

### A. Minimum OS raised
Compare the new floor to the `min_os` of the newest `updates` row per platform
(the floor of the release just before it).

- Count active devices below the new floor from `device_telemetry`.
- **Safer path:** can it ship without the native change? Over-the-air (Expo
  Update) changes never move the floor. Check that over-the-air updates are
  actually set up first: `updates.url` in `app.config.js` and a `channel` in the
  `eas.json` build profiles. If not, say so instead of recommending it.
- **If the floor must rise:** the new row must carry the new `min_os`. Devices
  below it then get `optional` or `unsupported`, never a lockout, **as long as**
  they run a build that sends the headers. If telemetry shows active users on
  builds that don't send the headers (`app_version` is NULL, or no row at all),
  do **not** mark this release mandatory.

### B. API change that breaks old app versions
Did a client route's request or response change in a way an old app version can't
handle: a removed or renamed field, a changed type, a new required param, or a
removed route?

- Find the oldest app version still in use (telemetry), then read that version's
  code: `git -C ../aashray-app log --oneline -S"version: '<v>'" -- app.config.js`
  gives the commit. Grep that commit for the field or route.
- **Safer path:** make it additive. Add new fields, keep the old ones until
  telemetry shows no app below that version.
- **If it must break:** add a mandatory row at the first fixed version, and confirm
  that version's `min_os` lets the affected devices install it.

## Output (always this shape, short)

```
Who this strands: <platforms + OS / app versions, with counts or "not sized">
Change that wouldn't: <the over-the-air / additive alternative, or "none">
If shipping as-is: <the exact updates row to add: version, min_os, mandatory>
```

If nothing is stranded, say so and list the files and queries you checked. Never
invent counts. If telemetry is empty, say "flagged, not sized".

## Keep this skill current

When a run hits something this file got wrong (a moved config key, a query that
errors, a stranding path neither check covers), name the gap in one line, propose
the exact edit, and apply it on the user's OK in the same session.
