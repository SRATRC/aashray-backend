# Version & OS Compatibility (Forced-Update) Spec

**Status:** Locked. This document is the single source of truth for the OS-aware,
tiered forced-update system. The backend, the API contract, and the pre-release
orphan-detector skill all validate against the field names and algorithm defined here.
Change this doc first; then change code to match.

## Why this exists

The old system forced updates using **only** the app version. It ignored whether the
user's device OS could actually **install** the build being pushed. App builds carry a
minimum-OS floor that rises silently whenever a native library/SDK bump lands. Forcing a
user onto a build their OS can't install sends them to the store, the store refuses, and
they bounce back to an un-dismissable modal — **permanently locked out**. Android is the
sharp edge: Google Play offers no fallback to an older compatible build.

We also treated every update identically — a critical security fix and a minor feature
both forced everyone. Most updates can safely let old builds keep running.

**Goal:** never strand a user on a version their device can't run. Decide force / soft /
none **server-side** using both **OS compatibility** and **update severity (tier)**.

## Release model (`updates` table)

One row per released build, per OS. Source of truth for every decision.

| Column         | Type                              | Meaning |
|----------------|-----------------------------------|---------|
| `id`           | INTEGER PK                        | — |
| `os`           | ENUM(`android`,`ios`)             | Platform. |
| `version`      | STRING                            | Marketing version (e.g. `"2.5.0"`). Display only. |
| `build_number` | INTEGER                           | **Monotonic, store-aligned** (Android `versionCode`, iOS build number). **Primary comparison key** — integers avoid string-version ambiguity (`"10"` vs `"4"`). |
| `min_os`       | STRING, nullable                  | OS floor required to install this build, as the platform **marketing version string** (`"13"`, `"16.0"`). **NULL = no floor / installable by everyone.** |
| `tier`         | ENUM(`optional`,`required`)       | Severity of *this* release. `required` ⇒ force eligible devices; `optional` ⇒ soft prompt. Default `optional`. Enum so a `recommended` tier can be added later without a breaking change. |
| `mandatory`    | BOOLEAN (**deprecated**)          | Legacy. Derived from `tier` in the response for old clients. Source of truth is `tier`. |
| `releaseNotes` | TEXT, nullable                    | — |
| timestamps     | —                                 | `createdAt` used as a stable tie-breaker. |

### The OS version contract

`min_os` and the client's reported OS version are **both** the platform **marketing
version string** — iOS `"16.3.1"`, Android `"13"`. We deliberately do **not** store
Android API levels: Play Store gates installability by `minSdkVersion` (API level), but
marketing versions are monotonic, which is all the ordering the algorithm needs. Keep
data entry to one format humans recognize.

## Client → server contract

The client sends compatibility info via **request headers**:

| Header          | Example     | Meaning |
|-----------------|-------------|---------|
| `x-platform`    | `android`   | `android` \| `ios`. Falls back to `?os=` query param (legacy). |
| `x-app-build`   | `240`       | The client's own `build_number` (integer). |
| `x-os-version`  | `13`        | Device OS marketing version string. |

`GET /api/v1/updates` — public, no auth.

If `x-app-build` **or** `x-os-version` is missing or unparseable, the server returns the
**legacy response** and makes no decision (see back-compat below). This is deliberate:
we never force when installability cannot be proven.

## The OS-ladder decision (server-side)

```
rows        = updates for platform, sorted by build_number DESC
installable = rows where min_os IS NULL OR compare(min_os, osVersion) <= 0   // rungs this device can reach
latest      = max build_number over rows
target      = max build_number over installable        // top rung this device can reach (may be null)
highestReq  = max build_number over rows where tier = 'required'   // the force floor (may be null)

if x-app-build or x-os-version missing/unparseable  -> LEGACY response
else if current >= latest                           -> none
else if highestReq && current < highestReq:
        if target && target >= highestReq           -> forced       (targetBuild = target)
        else                                        -> unsupported  (soft; keep using; targetBuild = target|null)
else if target && target > current                  -> optional     (targetBuild = target)
else                                                -> none
```

- **Anchor force on `highestReq`** (the newest `required` build), not "any required build
  newer than me." This correctly handles multiple `required` releases and ties.
- **`targetBuild` is always the newest installable rung.** We can never force a client
  onto a build its OS can't install.
- **`unsupported`** = the device can't climb high enough to reach a `required` fix. The
  client shows a **soft, dismissable, keep-using notice** — never a store dead-end. This
  is the exact lockout we are eliminating.
- Comparisons: `build_number` is a plain integer compare; `min_os` vs `osVersion` uses the
  total numeric dot-segment comparator in `utils/versionCompare.js` (returns `-1|0|1|null`,
  never throws; `null` ⇒ treat as unparseable ⇒ legacy fallback).

## Response (strict superset of the old shape)

```jsonc
{
  "message": "Fetched results successfully",
  "data": {
    "latestVersion": "3.0.0",   // legacy, unchanged semantics (marketing version of the latest row)
    "mandatory": true,          // legacy, derived from the latest row's tier === 'required'
    "releaseNotes": "…",        // legacy (latest row's notes)

    // present only when a server decision was made (both headers supplied & parseable):
    "updateType": "forced",     // none | optional | forced | unsupported
    "targetBuild": 240,         // newest installable build_number; may be < latest, or null
    "targetVersion": "2.5.0",   // marketing version for targetBuild (null if targetBuild is null)
    "minOsVersion": "17.0"      // floor of the *latest* build, for messaging ("needs iOS 17"); nullable
  }
}
```

Old clients keep reading `latestVersion` / `mandatory` and behave exactly as before.
New clients read `updateType` + `targetBuild`.

## Telemetry (`device_telemetry` table)

The backend records no OS/app-version on normal traffic, so today we cannot size *how
many* users a release would orphan. We capture last-seen device facts so the skill can
quantify impact.

| Column        | Type                    | Meaning |
|---------------|-------------------------|---------|
| `id`          | INTEGER PK              | — |
| `cardno`      | STRING, nullable        | User card number if authenticated; null otherwise. |
| `platform`    | ENUM(`android`,`ios`)   | From `x-platform`. |
| `app_build`   | INTEGER, nullable       | From `x-app-build`. |
| `os_version`  | STRING, nullable        | From `x-os-version`. |
| timestamps    | —                       | `updatedAt` = last seen. |

Upserted on `(cardno, platform)` by a **non-blocking** middleware whenever the compat
headers are present. It must never delay or fail the response.

## Impact query (orphan sizing)

Given a candidate `min_os` floor `F` for platform `P`, users orphaned ≈ active devices on
`P` whose `os_version < F`:

```sql
SELECT COUNT(*) FROM device_telemetry
WHERE platform = :P
  AND os_version IS NOT NULL
  AND /* compare(os_version, F) < 0, evaluated app-side via versionCompare */;
```

(String comparison in SQL is unsafe for versions like `"10"` vs `"4"`; the skill pulls the
distinct `os_version` values and compares them app-side with the same comparator the
backend uses.)

## Backward compatibility guarantees

1. Response is a **strict superset** — legacy fields never change meaning.
2. Missing/unparseable headers ⇒ legacy response, no forcing.
3. `min_os` NULL ⇒ installable by everyone (every legacy row is installable, so no mass
   `unsupported` regression).
4. `mandatory` column is retained (backfilled from `tier`) until all clients read `tier`.
