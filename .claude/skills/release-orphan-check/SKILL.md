---
name: release-orphan-check
description: >-
  Pre-release check for an app release: who it strands, the change that strands
  nobody, and the exact `updates` rows to add. Looks for a raised minimum OS (old
  phones can no longer install) and an API change old app versions can't handle.
  Use before shipping an app release, when bumping the Expo SDK / minSdkVersion /
  deploymentTarget, before marking a release mandatory, or when changing a client
  API response. Triggers on "ship a release", "will this strand users", "OS floor",
  "min sdk / deployment target bump", "force update", "breaking API change",
  "what do I put in the updates table", "new release row".
---

# Release Orphan Check

Before an app release ships: who it strands, how to avoid it, and the exact
`updates` rows to add. Read-only: you recommend and hand over SQL, you never
write to the DB or edit release rows.

## How the update system works

- `updates` table, **one row per store release per platform**: `os`, `version`,
  `min_os`, `mandatory`, `releaseNotes`. `min_os` unit: iOS version (`"16.4"`),
  Android **API level** (`"26"`, same as `minSdkVersion`). NULL = everyone.
- **Apps that send `x-app-version` + `x-os-version`** get a per-device answer
  (`helpers/appUpdate.helper.js`): `forced` if below a mandatory release this OS
  can install, `unsupported` (dismissable notice, never a block) if below one it
  can't, else `optional` or `none`. Every mandatory row counts.
- **Apps that don't send them** (every build before the header change) get only
  the **newest row by `createdAt`**: its `version` and `mandatory`. For them:
  - a new row with `mandatory = 0` drops whatever force they have today;
  - `mandatory = 1` forces all of them, even phones whose OS can't install it.
    `min_os` does not protect them.
- `device_telemetry`: last-seen `app_version` + `os_version` per member and
  platform, from logged-in requests that send the headers.

## Step 1: gather (in parallel)

1. **The release.** The app repo is a sibling (`../aashray-app` from the
   backend). `git -C ../aashray-app fetch origin main`, then read everything at
   `origin/main` with `git show`, never the local checkout (it may be on another
   branch with someone's work).
   **Base**, per platform = the commit that set the last version shipped on
   that platform: `git -C ../aashray-app log --reverse --oneline
   -G"^    version: '<v>'" origin/main -- app.config.js | head -1` (the
   top-level expo `version:`, not the razorpay pod's). `<v>` = that platform's
   newest `updates` row, unless the user says a newer one shipped (ask Q1 from
   Step 3 now if the rows look stale: row versions behind `origin/main`).
2. **The OS floor** at the release and at the base. See
   `references/native-floor.md`. Read-only; never run `expo prebuild`.
3. **Does this release send the headers?** `git -C ../aashray-app grep -n
   x-os-version origin/main -- src`. If not, all of `min_os` protects nobody yet:
   say so first.
4. **Live data** via the aashray MCP (prod, read-only):
   `references/mcp-queries.md`. If `min_os` or `device_telemetry` is missing, the
   backend change isn't deployed: say so, and give rows without `min_os`.
   Production runs backend `origin/main`; treat that as what's deployed.

## Step 2: the two checks

### A. Minimum OS raised
Raised = the floor at the release is above the floor at the base. Don't use the
rows for this: older rows have NULL `min_os`.

- **Size it:** active devices below the new floor (telemetry). Always add that
  builds without the headers aren't counted.
- **Safer path:** can it ship over the air instead? Only if all hold:
  `updates.url` is set in `app.config.js`, the `eas.json` build profiles have a
  `channel`, and the change keeps the same runtime version (`runtimeVersion`
  policy `sdkVersion`: any SDK bump needs a store build; `appVersion`: any
  version bump does). Otherwise say over-the-air isn't available and why.
- **If the floor must rise:** header-sending builds below it get `optional` or
  `unsupported`, never a lockout. Builds without headers aren't protected: don't
  make the row mandatory while they may still be in use.
- **Apps without headers reach further back than the base.** If a row may be
  mandatory, also find the lowest floor ever shipped: the floor at the oldest
  version-bump commit of `app.config.js` (and each SDK bump since). Phones on
  builds older than that with an OS below the new floor can't install it.

### B. Change that breaks old app versions
- **Backend change:** a client route's request or response changed in a way an
  old app can't handle (removed or renamed field, changed type, new required
  param, removed route).
- **App-only release:** does the new app need a backend field or route that
  isn't deployed yet?
- To check an old app version: find the oldest one in use (telemetry), get its
  commit with `git -C ../aashray-app log --reverse --oneline -G"^    version:
  '<v>'" origin/main -- app.config.js | head -1`, and grep that commit.
- **Safer path:** additive. New fields beside old ones until no app below that
  version is active.
- **If it must break:** a mandatory row at the first fixed version.

## Step 3: the rows to add (every run)

One row per platform. Work each value out; don't guess.

| Field | Source |
|---|---|
| `version` | Top-level expo `version:` in `app.config.js` at `origin/main`. Must be higher than every row for that platform. **Ask: "Was `<v>` already submitted to either store?"** If yes, the app needs a version bump before this build. |
| `min_os` iOS / Android | The floor at the release (Step 1.2). |
| `mandatory` | `1` if check B found a break this release fixes. Otherwise **ask per platform**, and show what each choice does to apps without headers: `0` drops the force the newest row gives today (name it); `1` forces all of them, including phones that can't install it. Never default to `1`. |
| `releaseNotes` | Ask, or NULL. |

Warn when: the floor rose (check A); or `mandatory = 1` while devices below
`min_os` are active, or builds without headers may be.

Give the SQL for the user to run. `createdAt`/`updatedAt` have no default.

```sql
INSERT INTO updates (os, version, min_os, mandatory, releaseNotes, createdAt, updatedAt) VALUES
  ('ios',     '<version>', '<ios floor>',     <0|1>, <notes or NULL>, NOW(), NOW()),
  ('android', '<version>', '<android floor>', <0|1>, <notes or NULL>, NOW(), NOW());
```

Before the backend change is deployed, drop `min_os` from the column list and
the values. Add rows only; never edit or delete old ones.

## Output (always this shape, short)

```
Who this strands: <platforms + OS / app versions, with counts or "not sized">
Change that wouldn't: <over-the-air / additive alternative, or why there is none>
Rows to add: <the INSERT, filled in, with questions as marked placeholders>
Warnings: <floor raised, mandatory risks, rows edited in place; or "none">
Questions: <only the ones you need answered, one line each>
```

Never invent counts. If telemetry is empty or missing, say "flagged, not sized".

## Keep this skill current

When a run hits something this file got wrong (a moved config key, a query that
errors, a stranding path neither check covers), name the gap in one line, propose
the exact edit, and apply it on the user's OK in the same session.
