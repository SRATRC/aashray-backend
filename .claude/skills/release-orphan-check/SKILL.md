---
name: release-orphan-check
description: >-
  Pre-release guard that catches any users a release would orphan and steers you
  to the change that orphans nobody. Use during the plan phase (checks the plan),
  before a build (checks the git diff), or manually at the end of a feature cycle.
  Hunts for two things: a native OS-floor bump (raises the minimum OS, orphaning
  old phones) and an API contract break (changes an endpoint/response old app
  builds rely on). Validates against the version-os-compatibility model
  (build_number, min_os, tier, the OS-ladder) and reads the live release config
  read-only via the aashray MCP. Triggers on "ship a release", "will this orphan
  users", "OS floor", "min sdk / deployment target bump", "force update",
  "breaking API change", "release safety check".
---

# Release Orphan Check

**Purpose:** before a release ships, catch any users it would orphan — and steer
you to the change that orphans nobody. Turn "orphaning a user" from an accident
into a deliberate, visible choice.

This skill validates against the locked spec in
`docs/version-os-compatibility.md` (model fields `build_number`, `min_os`, `tier`,
and the OS-ladder). It reads the live release/config **read-only** via the
**aashray MCP** (`query_db`, `get_schema`). It runs locally because the ground
truth for the OS floor lives in native files, not the database.

## When to run

- **Plan phase** — the input is the plan text. Look for changes that would raise
  the OS floor or alter an API contract.
- **Before a build** — the input is `git diff <base>...HEAD` of the release branch.
- **Manually, end of a feature cycle** — re-verify everything against `main`.

## Inputs to gather

1. **The change**: the plan text, or `git diff` of the branch (prefer `--stat`
   first, then full diff of native + API-contract files).
2. **The native OS-floor truth**, in this priority order (a library can raise the
   floor silently, so check native first):
   1. `ios/Podfile.lock` + `android/app/build.gradle` (and `gradle.properties`)
   2. `app.config.js` / `app.json` (Expo `ios.deploymentTarget`,
      `android.minSdkVersion`, config plugins)
   3. The Expo SDK default deployment target / minSdk for the pinned SDK version
   See `references/native-floor.md` for exactly what to read and how to map
   Android `minSdkVersion` → marketing version.
3. **The live release config** via the aashray MCP — current `updates` rows and
   `device_telemetry`. See `references/mcp-queries.md`.

> If the native files are absent (e.g. you are in the backend repo), say so
> explicitly and run in **degraded mode**: you can still check the API contract
> and read the DB, but you cannot confirm the OS floor. Recommend re-running from
> the mobile/Expo repo.

## The two hunts

### 1. OS-floor bump — orphans old-OS phones
Did a native change raise the minimum OS above what the last shipped build
required? Compare the new native floor against the `min_os` of the current latest
`updates` row for each platform.

- **Safer path first:** *"Can this ship as JavaScript / over-the-air instead of
  native?"* An OTA (Expo Update) change never moves the floor. If the dependency
  can be swapped for a JS implementation or deferred, the release orphans nobody.
- **If it must ship native and must raise the floor:** mark the release
  `tier = required` and confirm the OS-ladder + honest `unsupported` screen catch
  the stranded users (soft, keep-using notice — **not** a store dead-end). Size the
  impact from `device_telemetry` (see below).

### 2. Contract break — orphans old app builds
Did an endpoint, request shape, or response shape that old app builds depend on
change incompatibly (removed/renamed field, changed type, new required param,
removed route)?

- **Safer path:** make the change **additive / versioned** — add new fields
  instead of renaming, keep old ones until old builds age out, or version the
  endpoint — so old builds keep working.
- **If it must break:** it becomes an OS-independent force condition — a
  `tier = required` release — and old builds below it must be forced. Confirm the
  forced target is installable for the devices in question (same OS-ladder check).

## Sizing the impact (honest limit)

If `device_telemetry` has rows, quantify the orphaned population (active users on a
platform whose `os_version` is below the new floor `F`). Pull distinct
`os_version` values via `query_db` and compare them **app-side** with the same
numeric comparator the backend uses (`utils/versionCompare.js` — never compare
version strings in SQL: `"10" < "4"` lexically). See `references/mcp-queries.md`.

**If `device_telemetry` is empty or absent**, state plainly: *"I can flag that this
release orphans users, but cannot yet size how many — the backend isn't recording
OS/app-version on normal traffic. Capturing that (the `device_telemetry`
middleware) is step 1."* Do not invent numbers.

## Output — every run ends with this shape

```
▎ Here's who this release orphans
    → <who: platforms + OS versions below the floor, and/or app builds below a
       broken contract; with counts if telemetry exists>

▎ Here's the change that wouldn't
    → <the JS/OTA alternative, or the additive/versioned API change>

▎ If you must ship it as-is, here's how to force it safely
    → set tier=required on the release row(s), and confirm the OS-ladder returns
      `unsupported` (soft, keep-using) — never a brick — for devices that can't
      reach the fix.
```

If nothing is orphaned, say so directly and confirm which files you checked.

## Guardrails

- Read-only only. Never write to the DB (the MCP user is SELECT-only anyway) and
  never modify release rows — you *recommend* `tier` changes, you don't apply them.
- Never fabricate impact numbers; distinguish "flagged" from "sized".
- Compare versions numerically, per `references/native-floor.md`.

## Keep this skill evolving — live, during the run

This skill is not fixed. The release landscape shifts under it: a new native
dependency raises the floor in a way this skill didn't look for, the Expo SDK
changes where the deployment target lives, a new API-contract shape slips
through, or the `updates` / `device_telemetry` schema grows a field. **When a run
exposes a gap — a real orphaning path this skill would have missed, a query that's
now wrong, a file location that moved — fix this SKILL.md (or its `references/`)
then and there, in the same session.** Don't defer it to "later" or trust memory.

Signals that the file needs an edit:
- You had to check a native file or config key not listed in "Inputs to gather"
  or `references/native-floor.md` → add it.
- An MCP query in `references/mcp-queries.md` returned the wrong shape or errored
  → correct it against the live schema.
- A reviewer or a shipped incident revealed an orphaning path (OS-floor or
  contract) the two hunts don't cover → add the hunt.
- The output shape didn't fit the decision the user actually had to make → refine it.

When the signal is clear (not a one-off), act in the same session: name the gap in
one line, propose the exact edit, and on the user's OK apply it — keeping the
structure, reusing the real moment as the example.
