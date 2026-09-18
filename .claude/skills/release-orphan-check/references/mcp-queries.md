# Reading the live release config via the aashray MCP

All queries are **read-only** (the MCP DB user is SELECT-only). Read the
`schema://aashray` resource or call `get_schema` once at the start to confirm column
names, then use `query_db`.

## Current release picture per platform

The latest build we ship, its OS floor, and its severity tier:

```sql
SELECT os, build_number, version, min_os, tier, createdAt
FROM updates u
WHERE build_number = (
  SELECT MAX(build_number) FROM updates WHERE os = u.os
);
```

Full release ladder for one platform (to reason about the OS-ladder):

```sql
SELECT build_number, version, min_os, tier
FROM updates
WHERE os = 'android'          -- or 'ios'
ORDER BY build_number DESC;
```

The current **force floor** (newest required build) per platform:

```sql
SELECT os, MAX(build_number) AS highest_required
FROM updates
WHERE tier = 'required'
GROUP BY os;
```

## Sizing the orphaned population

`device_telemetry` holds last-seen device facts (one row per user+platform). Because
SQL string comparison is wrong for versions (`"10" < "4"`), pull the distinct OS
versions and their counts, then compare **app-side** with the numeric comparator:

```sql
SELECT platform, os_version, COUNT(*) AS devices
FROM device_telemetry
WHERE platform = 'android'     -- or 'ios'
  AND os_version IS NOT NULL
GROUP BY platform, os_version;
```

Then, in the skill, sum the `devices` for every `os_version` that is numerically
**below** the candidate floor `F` (using `utils/versionCompare.js` semantics). That
sum is the number of users the new floor would orphan.

App builds below a broken contract (for a contract-break hunt):

```sql
SELECT platform, app_build, COUNT(*) AS devices
FROM device_telemetry
WHERE app_build IS NOT NULL
GROUP BY platform, app_build
ORDER BY app_build;
```

## Honest limit

If `device_telemetry` does not exist yet, or returns no rows, you can flag that a
release orphans users but **cannot size how many**. Say so; do not estimate. The
capture middleware (`middleware/DeviceTelemetry.js`) populating this table is the
prerequisite ("step 1").
