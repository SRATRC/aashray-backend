# Live data via the aashray MCP

All read-only (`query_db`; the MCP adds a LIMIT). Never compare versions in SQL:
`"10" < "4"` as strings. Pull the values, then compare in your head or with
`utils/versionCompare.js` rules (split on `.`, integer segments, missing = 0).

## Release rows

```sql
SELECT os, version, min_os, mandatory, createdAt
FROM updates
ORDER BY os, createdAt DESC;
```

If this errors on `min_os`, the backend change isn't deployed: re-run without it.

- **Header-sending apps:** the force floor is the highest `version` with
  `mandatory = 1`. Sort by `version` yourself; staff edit rows by hand.
- **Apps without headers:** only the newest row by `createdAt` counts. Note its
  `mandatory`: the new row replaces it for them.
- **Edited in place:** a row whose `version` was set in git (version-bump commit
  date) after the row's `createdAt` was edited later; `updatedAt` doesn't show
  hand edits. Earlier floors were lost. Say so; each store release should be a
  new row.

## Devices per OS (sizing check A)

```sql
SELECT platform, os_version, COUNT(*) AS devices
FROM device_telemetry
WHERE updatedAt > NOW() - INTERVAL 90 DAY
GROUP BY platform, os_version;
```

Sum `devices` whose `os_version` is below the candidate floor. iOS values are
versions, Android values are API levels.

## Devices per app version (check B, and the "no headers" guard)

```sql
SELECT platform, app_version, COUNT(*) AS devices
FROM device_telemetry
WHERE updatedAt > NOW() - INTERVAL 90 DAY
GROUP BY platform, app_version;
```

A row is written only when a logged-in request carries the headers, so users on
builds older than the header change don't show up at all. Say so whenever you
report counts.

## If `device_telemetry` is missing or empty

Say "flagged, not sized". Do not estimate.
