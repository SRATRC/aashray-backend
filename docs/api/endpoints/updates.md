# Updates

OS-aware, tiered app-update check for mobile clients. The **server** decides whether an
update is forced, optional, or impossible for the device — the client obeys the decision.

See [`docs/version-os-compatibility.md`](../../version-os-compatibility.md) for the full
model, the OS-ladder algorithm, and the rationale.

**Base path:** `/api/v1/updates`
**Auth:** None (public)

## GET /

Check for app updates.

**Query params:**
- `os` (legacy) — Platform: `android` or `ios`. Superseded by the `x-platform` header.

**Headers (new clients):**
- `x-platform` — `android` | `ios` (falls back to `?os=`).
- `x-app-build` — the client's own integer `build_number` (e.g. `240`).
- `x-os-version` — device OS marketing version string (iOS `"16.3.1"`, Android `"13"`).

If `x-app-build` **or** `x-os-version` is missing/unparseable, the server makes no
decision and returns the legacy response below (it never forces blindly).

**Success response (200):**
```jsonc
{
  "message": "Fetched results successfully",
  "data": {
    // legacy fields — always present, unchanged semantics
    "latestVersion": "3.0.0",   // marketing version of the latest release row
    "mandatory": true,          // derived from the latest row's tier === 'required'
    "releaseNotes": "Bug fixes and performance improvements",

    // present only when both compat headers were supplied & parseable:
    "updateType": "forced",     // none | optional | forced | unsupported
    "targetBuild": 240,         // newest build_number this device can install; may be < latest, or null
    "targetVersion": "2.5.0",   // marketing version for targetBuild (null if none installable)
    "minOsVersion": "17.0"      // OS floor of the latest build, for messaging; nullable
  }
}
```

**`updateType` semantics:**
- `none` — client is current, or nothing newer is installable. No prompt.
- `optional` — a newer installable build exists but no required fix; soft, dismissable prompt.
- `forced` — the device can install a build at/above the newest `required` release; force update to `targetBuild`.
- `unsupported` — a `required` fix exists but the device's OS is too old to install any build that contains it. Show a **soft, dismissable "your device can no longer be updated" notice** and let the user keep using the app. **Never** send them to the store (that is the dead-end this system eliminates).

**OS version contract:** `min_os` (server) and `x-os-version` (client) are both the
platform **marketing version string**. Android API levels are not used. A NULL `min_os`
means "no floor / installable by everyone."

**Backward compatibility:** the response is a strict superset of the old shape. Old
clients keep reading `latestVersion` / `mandatory` and behave exactly as before.

**Error responses:**
- `400` — Invalid platform (must be `android` or `ios`).
- `404` — No version information found for the platform.
