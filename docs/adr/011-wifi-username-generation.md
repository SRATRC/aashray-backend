# ADR-011: WiFi Username Generation Algorithm

## Context

Permanent WiFi access requires unique usernames. The facility issues WiFi credentials per-device, so the same person may have multiple usernames (one for phone, one for laptop, etc.). Usernames need to be human-identifiable (tied to the user's name and card) while remaining unique.

## Decision

Usernames are generated deterministically from user data with collision handling:

### Construction

1. **Strip known prefixes** from the card holder's name (`issuedto`): `rcof`, `rchk`, `cons`, `chak`, `divi`, `paon`, `guest`, `guest-`
2. **Extract name parts**: first word = first name, last word = last name (if multi-word)
3. **Append last 4 digits** of the card number
4. **Append device suffix**: `ph` (phone), `pc` (computer), `tb` (tablet), `ot` (other)
5. **Lowercase everything**

Example: Card `RCOF1234`, name `John Doe`, device `phone` -> `johndoe1234ph`

### Collision Handling

If the generated username already exists (in `pending`, `approved`, or `reset` status), query all matching usernames with a `LIKE` pattern and find the highest numeric suffix. Append `maxCounter + 1`:

- `johndoe1234ph` (first device)
- `johndoe1234ph1` (second phone registered)
- `johndoe1234ph2` (third phone)

### Dry-Run for Bulk Operations

Admin bulk WiFi code uploads support a `dryRun=true` query parameter. In dry-run mode, the entire import is processed (validation, dedup, matching) but the transaction is **rolled back** before committing. The response includes categorized rows (`matched`, `mismatched`, `invalidRows`, `toInsert`, `skippedExisting`) so the admin can preview before committing.

## Consequences

- Prefix stripping is hardcoded. New card prefixes require a code change.
- Username generation is deterministic but the collision counter can create gaps if intermediate usernames are deleted.
- The dry-run pattern uses an actual database transaction that is rolled back, meaning it holds locks during the preview. Large imports in dry-run mode could briefly affect other queries.

## Related Code

- `controllers/admin/wifiManagement.controller.js`: lines 796-887 (username generation), lines 817-832 (prefix stripping), lines 845-873 (collision handling), lines 373-472 (dry-run pattern)
