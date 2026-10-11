# Loading pilot data

This loads Census boundaries and public office directories for one pilot state and county.
Federal legislators load for that state. County and city directories are whatever
`page.directory` sources you configure for the pilot. Civic records are retired, not deleted.
Page changes wait for an editor. They are not written straight onto live offices or officials.

`ogr2ogr` (GDAL) must be on `PATH` for `tiger.boundaries`. It is not an npm package.
Each downloaded file is capped at 50 MB. A required national extract over that cap fails the run.
The national ZCTA file is skipped instead, and the command prints that.

## 1. Add a page.directory source

Create `data/page-sources/<name>.json`. `state` and `county` must match the flags you pass
to the pilot (`MD` and `Montgomery`). `officeId` is the office UUID these contact fields
apply to. `jurisdictionGeoid` is the Census GEOID for that county or place.

```json
{
  "name": "Montgomery County Council",
  "publisher": "Montgomery County",
  "url": "https://www.montgomerycountymd.gov/council/",
  "termsUrl": "https://www.montgomerycountymd.gov/",
  "method": "PAGE_COLLECTION",
  "schedule": "WEEKLY",
  "freshnessDays": 14,
  "levels": ["COUNTY"],
  "collectorKey": "page.directory",
  "config": {
    "state": "MD",
    "county": "Montgomery",
    "pageUrl": "https://www.montgomerycountymd.gov/council/",
    "jurisdictionGeoid": "24031",
    "officeId": "00000000-0000-4000-8000-000000000000",
    "item": { "tag": "article", "className": "official" },
    "selectors": {
      "name": { "tag": "h2", "className": "name" },
      "title": { "tag": "p", "className": "title" },
      "phone": { "tag": "a", "className": "phone", "attr": "href" },
      "email": { "tag": "a", "className": "email", "attr": "href" },
      "address": { "tag": "address", "className": "office" }
    }
  }
}
```

The collector requests `robots.txt`, then the page, at one request per second, with user agent
`CivicLinkBot/1.0 (+CONTACT_INBOX)`. A `Disallow` for that path skips the page. HTML is reduced
to text. Names and titles are queued against the official. Phone, email, and address are queued
against `officeId`.

## 2. Seed the bulk sources

`TIGER_YEAR` defaults to 2025.

```bash
pnpm db:seed:sources
```

That upserts Census TIGER/Line, unitedstates/congress-legislators, and Open States people,
then every JSON file in `data/page-sources/`.

## 3. Run the pilot

Dry-run prints `added`, `changed`, `retired`, and `pending` and does not write.

```bash
pnpm pipeline:pilot --state MD --county "Montgomery" --dry-run
pnpm pipeline:pilot --state MD --county "Montgomery"
```

Order: `tiger.boundaries`, `congress.legislators`, `openstates.people`, then each
`page.directory` source whose config state and county match. Runs use the System principal
and store a checksum on `source_runs.snapshot_sha`.

One collector:

```bash
pnpm pipeline:run tiger.boundaries --state MD --dry-run
pnpm pipeline:run page.directory --state MD --county "Montgomery"
```

TIGER downloads the pilot state's layers from `https://www2.census.gov/geo/tiger/TIGER{YEAR}/`
(state, the state congressional file for the current Congress, state legislative districts,
place, county subdivision, and school districts). County boundaries come from the Census
cartographic file `cb_{YEAR}_us_county_500k.zip` because the TIGER/Line national county file
is over 50 MB. A 404 on elementary or secondary school districts is skipped when Census does
not publish that layer for the state. The national ZCTA file is over 50 MB, so that layer is
skipped and the run says so. Jurisdictions upsert on `(type, geoid)`
with `ST_Multi(ST_MakeValid(...))`. Parents are state, then county, then place.
`boundary_vintage` is `TIGER{YEAR}`.

## 4. Review pending changes

In the admin API, `pendingSourceChanges` (`admin.civic:read`) lists queued rows.
`decideSourceChange` (`admin.source:decide`) accepts or rejects one row.

Accept applies the value when the row already points at a record: phone and email update
that office, address updates the office's first street line, and a name or title updates
the official. A brand-new name has no official yet, so accept does not create one. Enter
the official in admin, then reject the leftover pending row. Reject discards the value.

## 5. Re-run

Run the same command. An unchanged download is skipped and does not add pending rows.
Use `--dry-run` first when you change selectors. A TIGER re-run retires active jurisdictions
from that source and state whose GEOID is no longer in the file.
