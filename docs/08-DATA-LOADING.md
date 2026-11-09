# Loading pilot data

This loads Census boundaries and public office directories for the places on a pilot list.
Federal and state legislators load for each listed state. County and city directories are the
`page.directory` sources whose config matches a listed county. Civic records are retired, not deleted.
Page changes wait for an editor. They are not written straight onto live offices or officials.
A successful run sets `isPilot` on the listed state, its congressional, legislative, and ZIP
areas, and the named counties, places, school districts, and special districts. It does not
mark every county in the state file.

`ogr2ogr` (GDAL) must be on `PATH` for `tiger.boundaries`. It is not an npm package.
Each downloaded file is capped at 50 MB. A required national extract over that cap fails the run.
ZIP polygons are read with GDAL range requests and clipped to the state boundary, so the
national ZCTA file is not downloaded into the process.

## 1. Add a page.directory source

Create `data/page-sources/<name>.json`. `state` and `county` must match a county on the
pilot list. `jurisdictionGeoid` is the Census GEOID for that county or place. `officeId`
is optional: when it is set, accept updates that office. When it is omitted, accept creates
the office. `officeName` overrides the person's title as the office name.

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
to text. Each person becomes one pending `directory` row: office name, jurisdiction, name,
title, phone, email, and address. Accept creates or updates the office, the official, and the
current term. Reject discards the row.

## 2. Seed the bulk sources

`TIGER_YEAR` defaults to 2025.

```bash
pnpm db:seed:sources
```

That upserts Census TIGER/Line, unitedstates/congress-legislators, and Open States people,
then every JSON file in `data/page-sources/`.

## 3. Run the pilot

Dry-run prints `added`, `changed`, `retired`, and `pending` and does not write.

One county:

```bash
pnpm pipeline:pilot --state MD --county "Montgomery" --dry-run
pnpm pipeline:pilot --state MD --county "Montgomery"
```

Several places, from a JSON file:

```json
{
  "states": ["MD"],
  "counties": [{ "state": "MD", "name": "Montgomery" }],
  "places": [{ "state": "MD", "name": "Rockville" }],
  "schoolDistricts": [{ "state": "MD", "name": "Montgomery County Public Schools" }],
  "specialDistricts": []
}
```

```bash
pnpm pipeline:pilot --list data/pilot.json --dry-run
pnpm pipeline:pilot --list data/pilot.json
```

Do not run this until the pilot jurisdictions, sources, and test addresses are confirmed.
Order, once per listed state: `tiger.boundaries`, `congress.legislators`, `openstates.people`,
then each `page.directory` source whose config state and county match a listed county.
Runs use the System principal and store a checksum on `source_runs.snapshot_sha`.

Congress and Open States write the person, every published term (start and end), and the
current seat. A missing date stays null. The loader does not guess a year. `elected_year` on
a term is the year that person first took that same office in the current continuous run.
`first_elected_year` on the person is the earliest start of any office, when a date was
published. Phone, office address, and contact-form URL are stored on the office, with the
source and last-updated time. A U.S. representative is attached to the Census congressional
district (`24` plus the two-digit district, so Maryland 8 is `2408`). A U.S. senator is
attached to the state, one office per class. Congress stores every term from
congress-legislators. When that file has no image, the photo URL is
`https://theunitedstates.io/images/congress/225x275/{bioguide}.jpg` (public domain).

State legislators keep contacts from the Open States CSV. Term dates come from the Open
States people YAML (`https://github.com/openstates/people`, `data/<state>/legislature/*.yml`,
role `start_date` / `end_date`), matched by the Open States person id. The state photo is the
CSV `image` URL when it is https. The weekly source run sends HEAD to each photo URL and
stores `photo_status`. A missing or broken image is stored as null. Hosts the frontend must
allow in `next.config` `images.remotePatterns` and CSP `img-src`:

- `https://theunitedstates.io` for congressional portraits
- the https host of each Open States `image` URL (the host is whatever that column publishes; it is not one fixed CDN)

Civic Cards group offices by government level. `parent_id` remains nullable in the database
and is not cleared. The admin API, the jurisdiction tree, and the export Parent column do not
use it. Filter and group jurisdictions by `state`.

A state legislator is attached to the Census upper or lower district (`24` plus the
three-character district). An email is stored only when the mailbox contains part of the
person's name or is an office mailbox (`info`, `office`, `council`, and the same kind). Any
other email is queued for review and is not shown. If that district is not loaded yet, the
person is saved and the seat is added on the next people run. Re-running those two sources
links existing people even when the file has not changed. Census does not need to run again.

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
not publish that layer for the state. ZIP (ZCTA) polygons are clipped to the state with GDAL
and stored as jurisdictions. A ZIP lookup that crosses more than one district of the same type
returns those candidates with confidence MULTIPLE. County subdivisions, congressional districts, and state legislative districts store the Census long name (`NAMELSAD`), so a Maryland election district is `District 1` or `District 10, Deer Park` rather than the short code `1`. Cities and counties keep the short name (`Rockville`, `Montgomery`). Jurisdictions upsert on `(type, geoid)`
with `ST_Multi(ST_MakeValid(...))`. The loader may still set `parent_id` (state, then county, then place). That column is not part of the admin API or the export.
`boundary_vintage` is `TIGER{YEAR}`.

## 4. Review pending changes

In the admin API, `pendingSourceChanges` (`admin.civic:read`) lists queued rows.
`decideSourceChange` (`admin.source:decide`) accepts or rejects one row.

Accept of a `directory` row creates the office when the page has no `officeId`, then the
official and the current term, including phone, email, and address. Other accepted rows update
the record they already point at. Reject discards the value. An email queued from Congress or
Open States stays hidden until an editor accepts it.

## 5. Re-run

Run the same command. An unchanged download is skipped and does not add pending rows.
Use `--dry-run` first when you change selectors. A TIGER re-run retires active jurisdictions
from that source and state whose GEOID is no longer in the file.

## 6. Export a workbook

`pnpm data:export` reads the database and writes `exports/civic-data-<date>.xlsx`.
It does not write to the database, and it does not include residents, saved locations,
follows, or notifications. The workbook has no Parent column. Officials and terms include
`termEnd` and `electedYear`. Field_Coverage includes photo. Optional flags: `--state MD` and `--pilot-only`.
