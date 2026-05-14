# Updates

App version checking endpoint for mobile clients.

**Base path:** `/api/v1/updates`
**Auth:** None (public)

## GET /

Check for app updates.

**Query params:**
- `os` (required) -- Platform: `android` or `ios`

**Success response (200):**
```json
{
  "message": "Fetched results successfully",
  "data": {
    "version": "2.1.0",
    "mandatory": true,
    "releaseNotes": "Bug fixes and performance improvements"
  }
}
```

Returns the latest version entry for the specified OS from the `updates` table.

- `mandatory: true` indicates the client app should force the user to update
- `mandatory: false` indicates the update is optional

**Error responses:**
- `400` -- Invalid OS value (must be `android` or `ios`)
