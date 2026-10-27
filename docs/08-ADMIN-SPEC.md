# 08 — Admin Panel Spec (Super Admin: Civic Card, Admin Users and Settings)

> Source: Leen Design Studio admin panel screen spec, 23 Oct 2026 (text extracted from the PDF). This is the source of truth for admin behaviour. Items marked (proposed) or listed in section 28 need QubaLink's confirmation.

CivicLink Super Admin: Civic Card, Admin Users and Settings
Leen Design Studio · CivicLink Phase 1 · Admin panel screen spec · 23 October 2026

This is the full specification of the Super Admin panel for CivicLink Phase 1, checked
against the signed Scope of Work (A1 to A20) and the Service Agreement. Sections 1 to 3
record the decisions on Civic Cards, admin users and the account menu. Sections 4 to 27
specify every screen, field and rule, and section 28 lists what to confirm with QubaLink.

## 1. Civic Card: keep it, with edit and add

A Civic Card is a view assembled from offices, officials and services (A7). If admins edit
the card itself, the same data lives in two places. So the Civic Card is built as a view over
the existing records, with edit and add actions that open or create those records.

List screen (one row per jurisdiction)

- Jurisdiction, level, parent
- Offices with a current official, and offices that are vacant
- Linked services count
- Freshness: the oldest "last updated" among its records, and a "may be outdated" flag
- Coverage notice status (a level or office can't be resolved)
- Status

Card screen (opens from a row)

- A preview exactly as residents see it, grouped by level of government: jurisdiction and district, office, officeholder, contact, source, last updated, freshness, services and resources
- Edit on any block, which opens that official, office or service record
- Add buttons: add office, add official to an office, add service, link an existing office
- Coverage notice toggle or note, for where a level can't be resolved

This gives "edit and add" with no new data model. A card with its own fields would be a
new feature and would need a Change Order.

## 2. Admin and staff users: new tab, needs QubaLink's written OK

A9 only lists login and secure sessions. A3 says admin access is "according to granted
permissions", but A20 excludes "staff role-based access". A user-management tab sits
between the two. Keep it to the simplest version and get QubaLink to confirm by email
before building it.

Roles (fixed, no custom role builder)

| Role | Can do |
|---|---|
| Super Admin | Everything, plus manage admin users |
| Admin / Staff | Create and edit records, review corrections, send alerts. No user management, no source deletion, no retiring of jurisdictions |

Admin Users screen (Super Admin only)

- List: name, email, role, status (invited / active / deactivated), last login, created by and date.
- Add user: name, email, role. This sends an invite email, and the invitee sets a password through the existing Update Password screen.
- Edit: change role, resend invite, reset password, deactivate (not delete).
- Guards: you can't deactivate yourself or the last Super Admin. A deactivated user's sessions end immediately.

If QubaLink wants per-section permissions or custom roles, that is a Change Order.

## 3. Settings: profile and password menu only

The gear icon opens a small menu, not a settings area:

- Profile: name and email
- Change password
- Logout

Add one "My Profile" screen showing name, email, role, last login and change password.

Updated sidebar

Dashboard, Civic Cards, Offices, Officials, Jurisdictions, Corrections, Services &
Resources, Sources, Alerts, Admin Users (Super Admin only). Partners is removed
because it is not in the SOW.

To confirm with QubaLink

1. Civic Card is a view-only composer over existing records, with edit and add opening the underlying records.
2. Two fixed admin roles (Super Admin and Admin / Staff) are within A3 and A9. If not, a Change Order is needed.
3. The gear icon is a profile and password menu only.

## 4. Global layout and shared patterns

The sections from here on specify every Super Admin screen: purpose, data shown, fields,
actions and states. Items marked (proposed) are our suggestion and are not in the SOW
wording, so they need agreement before build. Everything else comes from A3, A7, A8, A9,
A10 and A15 of the signed Scope of Work.

### 4.1 Page frame

- Top bar: CivicLink logo, global search, notification bell (with unread dot), profile icon, gear icon.
- Sidebar: Dashboard, Civic Cards, Offices, Officials, Jurisdictions, Corrections, Services & Resources, Sources, Alerts, Admin Users (Super Admin only). The active item is highlighted. The label is 'Corrections', not 'Corrections Que'.
- Content area: every screen has its own page title. 'Welcome, <first name>' appears on the Dashboard only. Detail and edit screens also show a breadcrumb.

### 4.2 Standard list screen

Every list screen (Civic Cards, Offices, Officials, Jurisdictions, Corrections, Services &
Resources, Sources, Alerts, Admin Users) has the same pattern:

- At a Glance: four count tiles specific to the module. Each tile opens the list filtered to that count.
- Table card: title, search within the table, filter bar, Add New button (where the role allows it), sortable column headers, pagination at 25 rows per page with a page-size selector (25 / 50 / 100, proposed).
- Row behavior: clicking a row opens its detail screen. A row menu (three dots) holds View, Edit and Retire or Reactivate, plus module-specific actions.
- Wide tables scroll sideways inside the card. The ID and name columns stay fixed on the left.
- Filters: listed under each module. 'Clear filters' resets them.
- Not included: CSV export, bulk import and custom report builders (not in A9, and A20 excludes report builders).

### 4.3 Standard add and edit screen

- Opens as a full page with breadcrumb, a title ('Add office', 'Edit office: <name>'), the form in titled sections, and a sticky footer with Cancel and Save.
- Required fields are marked with an asterisk. Validation runs when a field loses focus and again on Save. Errors show under the field, with a summary at the top.
- Leaving with unsaved changes shows a confirm prompt.
- IDs are system-generated and read-only.
- After Save, a success message appears and the admin returns to the record's detail screen. 'Updated by' and 'Updated at' are set automatically.
- Retire, never delete (A9). The confirm dialog says what happens: the record stops appearing on resident Civic Cards and linked records stay in place. An optional note is stored. Status becomes Retired. 'Reactivate' reverses it.

### 4.4 Shared provenance block

Used on Officials, Offices and Jurisdictions. Services use 'Last validated' instead (see Services & Resources).

| Field | Notes |
|---|---|
| Source * | Picked from the Sources list |
| Source URL | The source's page or the record-specific page, shown as a link |
| Last updated | Date, set by the automated collection (A8) or by an admin edit |
| Freshness | Current or May be outdated |
| Override | Toggle. Lets an admin set the source, last-updated date or freshness by hand (A8) |
| Override reason | Required when Override is on |
| Overridden by / at | Set automatically |

Rules: freshness is calculated from the source's 'Mark as outdated after (days)' setting.
An override replaces the calculated value until it is switched off. Residents see source
name, last-updated date and freshness on the Civic Card (A7). An automated refresh
never overwrites a field that has an active override (proposed). If the source later shows a
different value, the record is flagged 'Source changed since override' so an admin can
review it (proposed).

### 4.5 Standard states (A15)

| State | Behavior |
|---|---|
| Loading | Skeleton rows and tiles |
| Empty (no records yet) | Short explanation and an Add New button |
| Empty (no results for search or filters) | 'No results' with a Clear filters link |
| Load error | Message and a Retry button |
| Permission denied | 'You don't have access to this page' with a link to the Dashboard (for example, Admin / Staff opening Admin Users) |
| Save error or network error | The form stays filled, an error banner appears, and Retry is offered |
| Success | Toast message |
| Validation error | Inline message under the field |
| Session expired | Modal with 'Log in again'; returns to the same page afterwards |

### 4.6 Statuses and formats

- Statuses: Active, Retired, Pending, In Review, Applied, Dismissed, Current, May be outdated, Healthy, Overdue, Failed, Draft, Sent, Partly failed, Invited, Deactivated.
- Every badge has a text label. Color is never the only signal.
- Dates: MMM D, YYYY (for example Oct 23, 2026). Date-times add the time.
- IDs: short system IDs such as OFF-0001, as in the mockups' ABC-123 style. Each module has its own prefix.

### 4.7 Global search

Searches names and IDs across offices, officials, jurisdictions, services, sources and
corrections. Results are grouped by type with five per group, and 'View all' opens that
module's list with the search filled in. Minimum two characters.

### 4.8 Header menus

- Notification bell: the Activity dropdown (see Account and notification menus).
- Gear icon: Account settings menu with My Profile and Change password only. There is no wider Settings area.
- Profile icon: shows name and role, with Logout.

## 5. Authentication screens

Admin sign-in uses email and password (A9: authenticated access, secure sessions,
logout). There is no self-signup and no Google or Apple sign-in for admins.

### 5.1 Log in

- Fields: Email, Password (with Show / Hide toggle).
- Links and buttons: 'Forgot password?', Log In.
- Behavior: Enter submits. On success the admin goes to the Dashboard, or to the page they were trying to open.

Errors:

- Empty field: 'Enter your email' / 'Enter your password'.
- Wrong details: 'Email or password is incorrect'. The same message is used for unknown and deactivated accounts, so the screen never reveals which accounts exist.
- Too many failed attempts: a temporary lock message (proposed: 5 failed attempts, 15-minute lock).
- Network error: 'Something went wrong. Try again.'

### 5.2 Forgot password

- Fields: Email. Button: Send Reset Link.
- After sending: the same confirmation appears whether or not the account exists ('If this email is registered, we've sent a reset link').
- Link back: 'Back to log in'.

### 5.3 Reset email

Contains the reset link, the time it stays valid (proposed: 60 minutes, single use) and a
note to ignore the email if it wasn't requested.

### 5.4 Update password

- Fields: New password, Confirm password, each with Show / Hide.
- Rules shown beside the field (proposed): at least 12 characters, not the same as the email address, not a commonly used password.
- Button: Update Password.
- Errors: passwords don't match, rules not met, and an expired or already-used link. The expired state is its own screen: 'This link has expired' with a 'Request a new link' button.

### 5.5 Password updated

Confirmation message and a Log In button. All other sessions for that account are ended.

### 5.6 Invite acceptance (new admin and staff users)

- The invited person receives an email with a link (proposed: valid 7 days).
- The link opens the Update Password screen with the heading 'Welcome to CivicLink: set your password'.
- On success the user's status changes from Invited to Active.
- An expired invite shows 'This invite has expired. Ask your Super Admin to send a new one.'

### 5.7 Sessions

Secure session handling and logout (A9, Annexure F). Proposed: idle timeout of 30
minutes with a warning two minutes before, then the Session expired modal.

## 6. Dashboard

Purpose: a landing page that shows what needs attention. It holds counts and lists only.
There are no charts (A12 excludes a bespoke analytics dashboard in the admin panel).
Visible to both roles.

### 6.1 Welcome banner

'Welcome, <first name>!' with a short line ('Here is what needs attention today') and a
Create button. Create opens a menu: Add office, Add official, Add jurisdiction, Add
service, New alert, Add civic card. Super Admin also sees Add admin user.

### 6.2 At a Glance (four tiles)

| Tile | Definition | Opens |
|---|---|---|
| Pending corrections | Count of Pending and In Review, with the age of the oldest underneath | Corrections, filtered |
| Records may be outdated | Officials and offices with freshness 'May be outdated' | Offices, filtered |
| Source issues | Sources that are Overdue or Failed | Sources, filtered |
| Alerts needing attention | Alerts from the last 7 days with failed delivery | Alerts, filtered |

Below the tiles, a small totals strip shows Officials, Offices, Jurisdictions and Services &
Resources counts.

### 6.3 Needs attention table

| Column | Content |
|---|---|
| Type | Correction, Record, Source or Alert |
| Item | Name or ID, linked |
| Reason | For example 'Pending 6 days', 'May be outdated', 'Refresh failed', '12 deliveries failed' |
| Age | Days since it needed attention |
| Action | Review, Open or Retry link |

Sorted oldest first, showing five rows with a 'View all' link.

### 6.4 Recently edited records

| Column | Content |
|---|---|
| Record | Name, linked |
| Type | Office, Official, Jurisdiction, Service, Source |
| Action | Created, Edited, Retired, Reactivated, Correction applied |
| By | Admin name |
| Date and time | When |

Shows the last ten changes. It replaces the 'Recent Activity' table that showed Publish
and Pending statuses and durations.

### 6.5 Pilot coverage panel

A list of the pilot jurisdictions confirmed at Milestone 1 (A19), one row each with:
boundary data (OK or Missing), number of linked offices, and freshness (Current or May
be outdated). A summary line reads, for example, '8 of 10 pilot jurisdictions fully covered'.
Each row opens the jurisdiction.

### 6.6 Removed from the current mockup

Active Users tile, Upcoming Events tile, the Followers statistics chart, and the time and
duration column. None are in the SOW (A12, A20). Usage analytics are viewed in the
analytics provider's own dashboard (A12), and a link to it from the Dashboard header is
proposed.

## 7. Civic Cards

Purpose: see and manage each jurisdiction's card as residents see it. A card is assembled
from existing offices, officials and services (A7). It has no data of its own, so edits always
happen on the underlying record.

### 7.1 Civic Cards list

Tiles: Total civic cards, Fully covered, Partial coverage, May be outdated.

| Column | Content |
|---|---|
| Jurisdiction | Name, linked to the card |
| Level | Federal, State, County, Municipal, Education, Special district |
| Parent | Parent jurisdiction |
| Offices | Count |
| Vacant offices | Offices with no current official |
| Services | Linked services count |
| Oldest update | The oldest 'last updated' among its records |
| Freshness | Current, or May be outdated if any record is |
| Coverage | Complete or Partial |
| Status | Active or Retired |

Filters: level, parent or state, coverage, freshness, status. Add New starts the Add civic
card flow.

### 7.2 Card screen

- Header: jurisdiction name, level, parent, status, and an 'Edit jurisdiction' link.
- Resident preview: offices grouped by level of government (Federal, State, County, Municipal, Education, Special district). Each office block shows office name, officeholder name and title (or 'Vacant or unknown' while keeping the office visible), contact details, source name, last-updated date, freshness, the plain-language reason the office applies to the location (read-only, generated by the resolution logic), and the linked services with category, description, link and last-validated date.
- Per block: Edit (opens the office, official or service record) and Retire.
- Per level section: Add office, Add official, Add service, Link existing office. A level with no offices shows a 'Not covered yet' placeholder with an Add office button.
- Coverage notice: shows the coverage status and lets the admin add or edit the note residents see where a level can't be resolved (the note field is proposed).

### 7.3 Add civic card

1. Pick a jurisdiction by search, or choose 'Create new jurisdiction' (opens the Add jurisdiction form).
2. The card screen opens with an empty section for each government level and prompts to add offices, officials and services.

No separate card record is created, so there is no second copy of the data.

## 8. Offices

### 8.1 Offices list

Tiles: Active offices, Vacant offices, May be outdated, Missing contact details.

| Column | Content |
|---|---|
| ID | System ID |
| Office name | Linked |
| Level | Government level |
| Office type | Elected, Appointed, Department, Commission |
| Jurisdiction | Name |
| District or seat | From the jurisdiction, where the source provides it |
| Current official | Name, or 'Vacant or unknown' |
| Email or contact page | As published |
| Website | Link |
| Office address | As published |
| Source | Source name |
| Last updated | Date |
| Freshness | Current or May be outdated |
| Status | Active or Retired |

Filters: level, office type, jurisdiction, has an official (yes or no), freshness, status.
Removed from the mockup: Employee, Claims, and anything about time and duration.
They are not in the SOW, and 'Claims' edges toward the office portal that A20 excludes.

### 8.2 Add and edit office

| Section | Fields |
|---|---|
| Identity | Office name *, Government level *, Office type *, Jurisdiction * (District or seat shows read-only from the jurisdiction) |
| Officeholder | Current official (picker), 'Vacant or unknown' checkbox, 'Add new official' link |
| Contact | Website (https URL), Phone, Email or contact-page URL, Public office address (street, city, state, ZIP) |
| Linked services | List of linked services, with Link existing and Add new |
| Provenance | The shared provenance block |
| Status | Active or Retired |

Validation: the name must be unique within its jurisdiction. The URL, phone and email
formats are checked. A jurisdiction is required. Contact fields are optional because they
appear 'as published by the source' (A7).

### 8.3 Office detail

Header with name, level, type, status and an Edit button. Sections: Overview, Current
official, Linked services, Provenance, Related corrections (count, linked to the
Corrections list filtered to this record), and Updated by and at.

## 9. Officials

### 9.1 Officials list

Tiles: Active officials, Terms ending within 90 days, May be outdated, Missing contact
details.

| Column | Content |
|---|---|
| ID | System ID |
| Name | Linked |
| Title | For example U.S. Representative |
| Office | Linked |
| Level | Government level |
| Jurisdiction | Name |
| District | District or seat, where provided |
| Office type | Elected, Appointed, Department, Commission |
| Phone, Email, Website | As published |
| Office address | As published |
| Source, Last updated, Freshness | From the provenance block |
| Status | Active or Retired |

Filters: level, jurisdiction, office type, office, status, freshness. In the mockup the
Jurisdiction column held values like District and County. Those are levels, so they move to
Level and Jurisdiction shows the actual name.

### 9.2 Add and edit official

| Section | Fields |
|---|---|
| Identity | Full name *, Title *, Office * (picker) |
| Term | Term start, Term end |
| Contact | Website, Phone, Email or contact page, Address (with a 'Use office address' checkbox) |
| Provenance | The shared provenance block |
| Status | Active or Retired, with retired date and note |

Rule: one active official per office. A body with several members is modelled as one office
per seat. Confirm this with QubaLink. An official's jurisdiction comes from their office, so
the jurisdiction mapping that A9 asks for is set once, on the office.

### 9.3 Official detail

Header with name, title, office, status and Edit. Sections: Overview, Contact, Office and
jurisdiction, Provenance, Related corrections, Updated by and at.

## 10. Jurisdictions

### 10.1 Jurisdictions list

Tiles: Active jurisdictions, Missing boundary data, No linked offices, May be outdated. The
list can be switched between a table and a tree view, because the hierarchy is the point.

| Column | Content |
|---|---|
| ID | System ID |
| Jurisdiction name | Linked |
| Level | Federal, State, County, Municipal, Education, Special district |
| Parent | Parent jurisdiction, or 'None (top level)' for federal |
| District or seat ID | Where the source provides it |
| Child jurisdictions | Count |
| Officials | Count |
| Offices | Count |
| Boundary | OK or Missing |
| Pilot | Yes or No (proposed) |
| Status | Active or Retired |
| Last updated, Freshness | From the provenance block |
| Description | Truncated |

Filters: level, parent, pilot, boundary status, freshness, status. Mockup mapping: the
'Type' column becomes Level using the six levels in A7. 'Electoral district' is a district ID,
not a level, and 'Other type' becomes Special district.

### 10.2 Add and edit jurisdiction

| Section | Fields |
|---|---|
| Identity | Name *, Level *, District or seat ID (optional, because A7 says 'where the source provides it'), Aliases (several allowed, since sources name the same county in different ways), Description |
| Hierarchy | Parent * (not required for federal) |
| Pilot | Pilot jurisdiction toggle (proposed; A19 limits Phase 1 to the set confirmed at Milestone 1) |
| Boundary | Read-only: source, effective date, coverage status. No drawing or geometry editing (A9 gives admins metadata, hierarchy and district identifiers only) |
| Provenance | The shared provenance block |
| Status | Active or Retired |

Validation: level is required. A parent is required except for federal. The parent can't be
the record itself or one of its children. A parent must sit at the same or a higher level
(federal above state, state above county, county above municipal; education and special
districts may sit under a state or a county). Names must be unique within a parent.

### 10.3 Jurisdiction detail

- Identity: name, aliases, level, district or seat ID.
- Hierarchy: parent above, children listed below, each linked.
- Boundary (read-only): static map preview, source, vintage or effective date, coverage status. Where the resolution logic flags overlapping or ambiguous districts, a read-only note says so (proposed, depends on what the resolution logic records).
- Offices in this jurisdiction: list with Link existing, Unlink and Add office. A8 maps resolved jurisdictions to offices, so this is where that link is managed.
- Services & resources: linked services.
- Provenance: the shared block.
- Updated by and at.

### 10.4 States and rules

- No linked offices: placeholder with an Add office button.
- Boundary missing: banner 'Boundary data is missing. Residents will see a coverage notice for this level.'
- Retire: allowed (UC-09 says jurisdictions are retired, although A9 only lists create and edit, so confirm). The dialog shows how many child jurisdictions and offices are affected. They stay in place and are flagged 'Parent retired'.

## 11. Corrections

### 11.1 Corrections list

Tiles: Pending, In Review, Applied in the last 30 days, Dismissed in the last 30 days. These
replace 'Queues', 'Updated Queues' and 'Dismissed Queues' in the mockup.

| Column | Content |
|---|---|
| ID | System ID, for example COR-0001 |
| Record type | Official, Office, Jurisdiction, Service |
| Record | Name, linked. Filled in automatically from the card or profile the resident reported from |
| Field | The field the resident picked, if the form offers one |
| Current value | What is on the record now, when a field is known |
| Proposed value | What the resident suggested, if they gave one |
| Description | What the resident wrote (UC-08: the resident describes the correction), truncated |
| Submitted by | Display name and account ID only (UC-08: only signed-in residents can submit). No email, address or saved locations (Section 13.2: minimum necessary use of Personal Data) |
| Submitted date | Date |
| Evidence | Link the resident supplied, if any |
| Status | Pending, In Review, Applied, Dismissed |
| Decided date | Date, blank until decided |
| Actions | Review, and Apply or Dismiss on open rows only |

Fixes to the mockup: 'Submitted date' appeared twice, the value columns held numbers,
and Apply and Dismiss showed on rows already Applied or Dismissed. Apply and Dismiss
now appear only on Pending and In Review rows. Default sort: oldest pending first. Filters:
status, record type, field, submitted date range, submitted by, age.

### 11.2 Correction review screen

- Header: correction ID, status badge, submitted by (name and account ID) and date.
- What was reported: the resident's description, any field they picked, the value they proposed, and the evidence link.
- Comparison: where a field and proposed value exist, the current and proposed values side by side with the difference highlighted. Where the resident only wrote a description, the record's current details are shown beside it.
- Record context: the record's name (linked) and its provenance (source, last updated, freshness).
- Other open corrections on the same record, listed and linked.
- Actions:
  - Mark in review: assigns it to the admin.
  - Apply: with a field and proposed value, a confirm dialog shows the change and applying updates the record. With only a description, Apply opens the record's edit form with the correction reference attached, and the correction is marked Applied when the record is saved. Either way the record's last-updated date is set and the correction is stored in its override fields (UC-10: record metadata is updated when applied).
  - Dismiss: a reason is required (A9). Preset reasons (proposed): Can't verify, Source is correct, Duplicate, Out of scope, Other, plus free text.
- After a decision: the screen becomes read-only and shows status, decided by, decided date and the reason.
- If the record changed after submission: a warning banner says so. Apply stays available after a confirm. If the record has been retired, Apply is disabled.

## 12. Services & Resources

### 12.1 Services list

Tiles: Total services & resources, Active, Inactive, Needs validation (not validated within
180 days, proposed). The mockup's 'Missing Identifiers' tile is replaced.

| Column | Content |
|---|---|
| ID | System ID |
| Service name | Linked |
| Category | For example Public Services, Government Assistance, Education, Community Programs |
| Linked office | Linked |
| Jurisdiction | Name |
| URL or contact | Link, phone or email |
| Last validated | Date |
| Status | Active or Inactive only. The mockup reused the corrections statuses (Applied, Dismissed), which don't apply here |
| Description | Truncated |

Filters: category, linked office, jurisdiction, status, validation age.

### 12.2 Add and edit service

| Field | Rules |
|---|---|
| Service name * | Plain language |
| Category * | Chosen from a fixed list (proposed) |
| Description * | Plain language, up to 300 characters |
| URL or contact * | An official URL, or a phone number or email; at least one |
| Linked office | Picker |
| Linked jurisdiction | Picker. At least one of office or jurisdiction is required (A9) |
| Last validated * | Defaults to today on create. A 'Mark as validated today' button updates it |
| Status | Active or Inactive |

CivicLink only links to government services. It does not submit applications, filings,
payments or service requests (A7), so there are no application or payment fields.

### 12.3 Service detail

Header with name, category, status and Edit. Sections: Overview, Linked office and
jurisdiction, Last validated, Updated by and at.

## 13. Sources

Scope line: this module manages source metadata and status only (A9: name, URL,
refresh method, freshness metadata). It is not an ingestion pipeline builder. The initial list
of public sources is selected and listed by Leen Design Studio at Milestone 1 (Section 4.4).

### 13.1 Sources list

Tiles: Total sources, Healthy, Overdue or failed, Paused.

| Column | Content |
|---|---|
| ID | System ID |
| Source name | Linked |
| Type | API, Bulk export, Scheduled page collection, Manual |
| Coverage | Levels or jurisdictions covered |
| Refresh method | As stored |
| Schedule | For example Daily, Weekly |
| Last successful refresh | Date and time |
| Last attempt | Date and time |
| Status | Healthy, Overdue, Failed, Paused |
| Records using | Count |
| Outdated after (days) | The freshness rule for its records |

Filters: type, status, level, schedule.

### 13.2 Add and edit source

| Field | Notes |
|---|---|
| Name * | |
| URL * | |
| Type * | API, Bulk export, Scheduled page collection, Manual |
| Terms-of-use URL | A8 requires collection consistent with each source's published terms |
| Levels or jurisdictions covered | Multi-select |
| Refresh method * and Schedule | How and how often the data is collected |
| Mark as outdated after (days) * | Drives the freshness state on records |
| Notes | Free text |
| Status | Active, Paused, Retired |

### 13.3 Source detail

- Overview with all fields above.
- Refresh history (proposed): the last ten attempts, each with date, result, number of records updated and any error note.
- Records using this source: counts by module, each linking to that module's list filtered by the source.
- Actions: Edit, Pause or Resume, Retire. 'Refresh now' is a manual trigger (proposed; A8 only describes scheduled collection).

## 14. Alerts

Scope line (A9): a basic alert tied to a supported office or official, with channels, preview,
send and delivery status. There is no scheduling, no audience builder and no editing or
recall after sending.

### 14.1 Alerts list

Tiles: Total alerts, Sent in the last 7 days, Drafts, Failed or partly failed.

| Column | Content |
|---|---|
| ID | System ID, for example ALT-0001 |
| Title | Linked |
| About | The office or official |
| Channels | In-app, Email, Push |
| Status | Draft, Sent, Partly failed, Failed |
| Audience | Followers reached at send time |
| Delivered | Count |
| Failed | Count |
| Sent by | Admin name |
| Sent date | Date and time |

Filters: status, channel, target type, date range, sent by.

### 14.2 New alert (compose)

1. Target: choose Office or Official, then the record. The screen shows how many residents follow it (read-only).
2. Content: Title * (up to 80 characters) and Message * (up to 500 characters). A link to the related profile is added automatically (A10).
3. Channels: In-app, Email, Browser or PWA push. At least one is required. A note explains that push reaches only residents who have opted in and whose browser supports it (A10).
4. Preview: one tab per selected channel, showing the in-app card, the email and the push banner.
5. Send: a confirm dialog states the audience and channels ('Send to 214 followers by email and push? This can't be undone').

Rules: duplicate-send protection (A10): the Send button is disabled after the first click,
and a sent alert can't be sent again. 'Duplicate as new draft' is available instead. Save as
draft is proposed. The audience is residents who follow the office or official and have
turned that channel on.

### 14.3 Alert detail

- Header: title, status, sent by, sent date and time.
- Content: the message, the target (linked) and the channels.
- Delivery status per channel:

| Channel | Targeted | Sent | Delivered | Failed | Not eligible |
|---|---|---|---|---|---|
| In-app | | | | | |
| Email | | | | | |
| Push | | | | | |

'Not eligible' means the resident has opted out of that channel or their browser doesn't
support it.

- Failures: the most common failure reasons with counts.
- Opens and clicks: shown where the channel supports them (A12 lists them as measures).
- Action: Duplicate as new draft.

## 15. Admin Users (Super Admin only)

This tab is not listed in A9. A3 refers to access 'according to granted permissions', and A20
excludes 'staff role-based access'. Build it as two fixed roles and get QubaLink's written
confirmation first.

### 15.1 Admin Users list

Tiles: Total users, Super Admins, Admin / Staff, Invited (not yet accepted).

| Column | Content |
|---|---|
| Name | Linked |
| Email | |
| Role | Super Admin or Admin / Staff |
| Status | Invited, Active, Deactivated |
| Last login | Date and time |
| Created by | Admin name |
| Created date | Date |

Filters: role, status.

### 15.2 Add user

- Fields: Name *, Email * (must be unique), Role *. Helper text beside each role explains what it can do.
- Action: Save and send invite. The invite email leads to the Update Password screen.

### 15.3 Edit user

- Actions: change role, resend invite, send password reset, deactivate or reactivate.
- Guards: you can't deactivate yourself or change your own role, and the last Super Admin can't be deactivated or demoted. Deactivating ends that user's sessions immediately. Users are deactivated, never deleted.
- Deactivate dialog: states that the user will be logged out and can no longer sign in.

## 16. Account and notification menus

### 16.1 My Profile

Name (editable), Email (shown; changed by a Super Admin), Role (read-only), Last login,
and a Change password button.

### 16.2 Change password

Fields: Current password *, New password *, Confirm password *. Same rules as the
Update password screen. On success a message appears and other sessions end.

### 16.3 Activity dropdown (notification bell)

- List: each item shows an avatar with initials, a title, a one-line preview, the date, and an unread dot. Clicking opens the related item and marks it read.
- Header actions: 'Mark all as read'. The gear inside the dropdown opens notification preferences (proposed, in-app only).
- Events (proposed): new correction submitted, source refresh failed, alert delivery failed, and, for Super Admin only, a new user accepted their invite.
- Empty state: 'You're all caught up'. Items are kept for 30 days (proposed).

## 17. Roles and permissions

| Capability | Super Admin | Admin / Staff |
|---|---|---|
| View Dashboard and all lists | Yes | Yes |
| Create and edit officials, offices, services | Yes | Yes |
| Retire and reactivate officials, offices, services | Yes | Yes |
| Create and edit jurisdictions | Yes | Yes |
| Retire jurisdictions | Yes | No |
| Review corrections (apply or dismiss) | Yes | Yes |
| Create and send alerts | Yes | Yes |
| Add and edit sources | Yes | No (view only) |
| Pause or retire sources | Yes | No |
| Admin Users tab | Yes | No |
| My Profile and Change password | Yes | Yes |

The fixed two-role model is proposed. Per-section permissions or custom roles would be a
Change Order.

## 18. Data reference

### 18.1 How the records connect

- A jurisdiction has one parent (except federal) and any number of children.
- An office belongs to one jurisdiction. An official holds one office.
- A service links to an office, a jurisdiction, or both.
- Officials, offices and jurisdictions each point to one source.
- A correction targets one field on one record.
- An alert targets one office or one official and goes to the residents who follow it.
- The Civic Card is a view over jurisdictions, offices, officials and services. It has no records of its own.

### 18.2 Lists of values

| List | Values |
|---|---|
| Government level | Federal, State, County, Municipal, Education, Special district |
| Office type | Elected, Appointed, Department, Commission |
| Record status | Active, Retired (services: Active, Inactive) |
| Freshness | Current, May be outdated |
| Correction status | Pending, In Review, Applied, Dismissed |
| Source status | Healthy, Overdue, Failed, Paused |
| Source type | API, Bulk export, Scheduled page collection, Manual |
| Alert channel | In-app, Email, Browser or PWA push |
| Alert status | Draft, Sent, Partly failed, Failed |
| User role | Super Admin, Admin / Staff |
| User status | Invited, Active, Deactivated |
| ID prefixes | JUR, OFF, PER (officials), SVC, COR, SRC, ALT |

## 19. Out of scope for Phase 1

These are not built without a signed Change Order (Section 10 of the Service Agreement):

- Analytics dashboards, follower or active-user charts (A12, A20)
- Events & Programs, and government publishing workflows (A20)
- Partners module
- Resident or subscription management screens (subscription status lives in the resident's account and the Stripe portal)
- Office portal, or role-based access for office staff (A20)
- Custom roles or per-section permissions
- Bulk import, CSV export and custom report builders
- Boundary drawing or geometry editing
- Alert scheduling, audience builders, editing or recalling sent alerts
- Inbox, ticketing or messaging with residents (A20)
- Multilingual content (A20)

## 20. Publishing and data rules

Edits go live on resident Civic Cards as soon as they are saved, and the panel's data
comes from the automated collection of public sources. The rules below follow from the
SOW.

- Edits are live (UC-09). Changes to officials, offices, jurisdictions and services show on resident Civic Cards when saved. There is no draft, preview-before-publish or approval step, because government publishing workflows are excluded (A20).
- Where the data comes from. Civic data is drawn from public sources by automated collection (A8). Content migration or manual data entry of civic records by Leen Design Studio is excluded (A20). The Add forms exist so QubaLink can fill gaps and correct data after launch.
- Accuracy is not Leen Design Studio's responsibility. Leen Design Studio does not create, verify or maintain civic data and is not responsible for its accuracy, completeness, freshness or coverage (Section 4.4).
- Overrides and refresh. An automated refresh does not overwrite a field with an active override (proposed). Switching the override off lets the next refresh restore the source value.
- Freshness. It is calculated from the last-updated date and the source's 'Mark as outdated after (days)'. The override sets source and last-updated (A8) and freshness follows.
- Retire. Retired officials, offices and services stop appearing on resident Civic Cards. History stays on the record and Reactivate restores it. Jurisdictions follow Section 10.4.
- Applied corrections mean the record has been changed and its metadata updated (UC-10).
- Sent alerts are final. There is no recall and no resend (A10: duplicate-send protection).
- Pilot limit (A19). Phase 1 covers the pilot jurisdictions confirmed at Milestone 1. Outside them, residents see a coverage notice.
- Resident accounts are not managed here. A3 and A9 give the admin panel no resident or subscription screens.
- Date and time display: in the admin's browser time zone (proposed).

## 21. What the Super Admin sees and does not see

Personal Data is used only to perform the Services and to the minimum extent necessary
(Section 13.2), and Annexure F requires data minimisation. The panel is built to match.

| Data | Admin sees | Admin does not see |
|---|---|---|
| Resident who submitted a correction | Display name and account ID | Email, address, saved locations, follows |
| Alert audience | Follower and delivery counts | Names or emails of recipients |
| Resident searches and addresses | Nothing | Any resident address (Annexure F: no full resident addresses in logs or analytics) |
| Admin users | Name, email, role, status, last login | Passwords or session tokens, which are never shown or logged |
| Source credentials | Name, URL and refresh method | API keys or secrets, which are kept in environment configuration, never in source code or on screen (Annexure F) |
| Billing | Nothing | Card data (A11: none stored) or Stripe details; subscriptions are handled in Stripe |
| Errors | Plain-language messages | Stack traces or technical detail (Annexure F: safe error handling) |

A suspected unauthorised access or Personal Data incident must be notified within 24
hours (Section 13.3).

## 22. Action states (A15)

A15 requires every user action to have loading, empty, success, validation-error,
permission-denied and network-error behavior. 'Not applicable' means the state can't
occur for that action.

| Action | Loading | Success | Validation error | Permission denied | Network error |
|---|---|---|---|---|---|
| Log in | Button spinner, fields locked | Go to Dashboard | 'Enter your email', 'Enter your password' | Not applicable | 'Something went wrong. Try again.' |
| Send reset link | Button spinner | Generic confirmation message | 'Enter a valid email' | Not applicable | Error banner and Retry |
| Update or change password | Button spinner | 'Password updated'; other sessions end | Rules not met, passwords don't match | 'This link has expired' screen | Error banner, form kept |
| Add or edit a record | Save button spinner, form locked | 'Saved' message, return to detail | Inline messages and a summary at the top | 'You don't have access to do this' | Banner with Retry, form kept |
| Retire or reactivate | Spinner in the dialog | Message; status badge updates | Not applicable | Action hidden; a direct link shows the access message | Banner in the dialog with Retry |
| Apply correction | Spinner in the dialog | 'Correction applied'; status Applied | Blocked if the record is retired | Same as above | Banner with Retry; the correction stays open |
| Dismiss correction | Spinner in the dialog | 'Correction dismissed' | 'Enter a reason' | Same as above | Banner with Retry; the correction stays open |
| Send alert | Send disabled, spinner | 'Alert sent'; opens the alert detail | Missing target, title, message or channel | Same as above | 'Not confirmed. Check Alerts before trying again' (never resent automatically) |
| Add or edit user | Spinner | 'Invite sent' or 'User updated' | Email already in use, name or role missing | Admin / Staff can't open the tab | Banner with Retry |
| Deactivate user | Spinner in the dialog | 'User deactivated'; sessions end | Blocked for yourself and the last Super Admin, with a message | Same as above | Banner with Retry |
| Search and filter | Table skeleton | Results update | 'Enter at least 2 characters' | Not applicable | 'Couldn't load results' with Retry |

## 23. Empty states

| Screen | Message | Button |
|---|---|---|
| Dashboard: Needs attention | 'Nothing needs attention right now.' | None |
| Dashboard: Recently edited | 'No edits yet.' | None |
| Civic Cards | 'No civic cards yet. Add a jurisdiction to start.' | Add civic card |
| Offices | 'No offices yet.' | Add office |
| Officials | 'No officials yet.' | Add official |
| Jurisdictions | 'No jurisdictions yet.' | Add jurisdiction |
| Jurisdiction detail: offices | 'No offices are linked to this jurisdiction.' | Add office, Link existing |
| Corrections | 'No corrections have been submitted.' | None |
| Services & Resources | 'No services or resources yet.' | Add service |
| Sources | 'No sources yet.' | Add source |
| Alerts | 'No alerts sent yet.' | New alert |
| Admin Users | 'You're the only user. Add a teammate.' | Add user |
| Activity dropdown | 'You're all caught up.' | None |
| Any list with filters or search | 'No results. Try clearing your filters.' | Clear filters |

## 24. Field reference

Every record also stores 'Created by', 'Created at', 'Updated by' and 'Updated at', set
automatically. Lengths are proposed and can change before build.

### 24.1 Jurisdiction

| Field | Type | Required | Rules |
|---|---|---|---|
| ID | Auto | Auto | JUR-0001 style, read-only |
| Name | Text, up to 150 | Yes | Unique within its parent |
| Aliases | Text list | No | Other names sources use |
| Level | List | Yes | Federal, State, County, Municipal, Education, Special district |
| Parent | Picker | Yes, except federal | Not itself or one of its children; same or higher level |
| District or seat ID | Text, up to 50 | No | Where the source provides it (A7) |
| Description | Text, up to 300 | No | |
| Pilot | Yes or no | No | Proposed |
| Coverage note | Text, up to 300 | No | Proposed; shown to residents where coverage is partial |
| Boundary source, effective date, status | Read-only | Auto | No editing (A9) |
| Source, Last updated, Freshness, Override | Shared block | Source: yes | Section 4.4 |
| Status | List | Yes | Active, Retired |

### 24.2 Office

| Field | Type | Required | Rules |
|---|---|---|---|
| ID | Auto | Auto | OFF-0001 style, read-only |
| Name | Text, up to 150 | Yes | Unique within its jurisdiction |
| Level | List | Yes | Same six levels |
| Office type | List | Yes | Elected, Appointed, Department, Commission |
| Jurisdiction | Picker | Yes | Sets the district or seat shown |
| Current official | Picker | No | One active official per office |
| Vacant or unknown | Checkbox | No | The office stays visible (UC-04) |
| Website | URL | No | https only |
| Phone | Text | No | Valid phone format |
| Email or contact page | Email or URL | No | As published by the source |
| Address | Street, city, state, ZIP | No | Public office address |
| Linked services | Multi-picker | No | |
| Source, Last updated, Freshness, Override | Shared block | Source: yes | Section 4.4 |
| Status | List | Yes | Active, Retired |

### 24.3 Official

| Field | Type | Required | Rules |
|---|---|---|---|
| ID | Auto | Auto | PER-0001 style, read-only |
| Full name | Text, up to 150 | Yes | |
| Title | Text, up to 150 | Yes | |
| Office | Picker | Yes | Jurisdiction comes from the office |
| Term start, Term end | Dates | No | End after start |
| Website, Phone, Email or contact page | As for offices | No | |
| Address | Street, city, state, ZIP | No | Defaults to the office address |
| Source, Last updated, Freshness, Override | Shared block | Source: yes | Section 4.4 |
| Status | List | Yes | Active, Retired, with retired date and note |

### 24.4 Service or resource

| Field | Type | Required | Rules |
|---|---|---|---|
| ID | Auto | Auto | SVC-0001 style, read-only |
| Name | Text, up to 150 | Yes | |
| Category | List | Yes | Fixed list (proposed) |
| Description | Text, up to 300 | Yes | Plain language |
| URL or contact | URL, phone or email | Yes | At least one |
| Linked office, Linked jurisdiction | Pickers | One of them | At least one is required (A9) |
| Last validated | Date | Yes | Defaults to today; not in the future |
| Status | List | Yes | Active, Inactive |

### 24.5 Source

| Field | Type | Required | Rules |
|---|---|---|---|
| ID | Auto | Auto | SRC-0001 style, read-only |
| Name | Text, up to 150 | Yes | |
| URL | URL | Yes | https |
| Type | List | Yes | API, Bulk export, Scheduled page collection, Manual |
| Terms-of-use URL | URL | No | A8: collection follows each source's terms |
| Levels or jurisdictions covered | Multi-picker | No | |
| Refresh method, Schedule | Text, list | Method: yes | Schedule: Daily, Weekly, Monthly or Manual |
| Mark as outdated after (days) | Number | Yes | 1 to 730 |
| Notes | Text, up to 500 | No | |
| Status | List | Yes | Active, Paused, Retired |
| Last successful refresh, Last attempt, Result | Read-only | Auto | Set by the collection |

### 24.6 Correction (submitted by a resident)

UC-08 says the resident 'describes the correction'. The exact form is to be agreed, and the
fields below are what the admin side needs.

| Field | Type | Required | Rules |
|---|---|---|---|
| ID | Auto | Auto | COR-0001 style |
| Record | Link | Auto | The card or profile the resident reported from |
| Field | List | No | Only if the form offers it |
| Description | Text, up to 1,000 | Yes | What the resident wrote |
| Proposed value | Text | No | |
| Evidence link | URL | No | |
| Submitted by, Submitted at | Account, date | Auto | Display name and account ID only |
| Status | List | Auto | Pending, In Review, Applied, Dismissed |
| Reviewer, Decision date | Admin, date | Auto | Set on decision |
| Decision reason | Text, up to 500 | Yes on dismiss | A9 |

### 24.7 Alert

| Field | Type | Required | Rules |
|---|---|---|---|
| ID | Auto | Auto | ALT-0001 style |
| Target type, Target record | List, picker | Yes | Office or official (A9) |
| Title | Text, up to 80 | Yes | |
| Message | Text, up to 500 | Yes | Profile link added automatically |
| Channels | Multi-select | Yes | At least one of In-app, Email, Push |
| Status | List | Auto | Draft, Sent, Partly failed, Failed |
| Audience count, delivery counts | Numbers | Auto | Counts only |
| Sent by, Sent at | Admin, date | Auto | |

### 24.8 Admin user

| Field | Type | Required | Rules |
|---|---|---|---|
| Name | Text, up to 100 | Yes | |
| Email | Email | Yes | Valid and unique |
| Role | List | Yes | Super Admin, Admin / Staff |
| Status | List | Auto | Invited, Active, Deactivated |
| Last login | Date and time | Auto | |
| Invited at, Invite expires | Dates | Auto | 7 days (proposed) |

## 25. Environment, accessibility and testing

- Browsers and devices (A14): the admin runs on the matrix confirmed at Milestone 1: the current and previous major versions of Chrome, Edge, Safari and Firefox on desktop.
- Responsive (Section 3.4): admin pages respond to screen width. Tables scroll sideways inside their card and the sidebar collapses into a menu on narrow screens.
- Accessibility (A15): WCAG 2.1 AA is a design reference, not a warranty. The admin uses semantic structure, keyboard navigation, visible focus states, reasonable colour contrast and labelled form fields. No audit or certification is included.
- Security (Annexure F): least privilege, secure sessions, HTTPS, server-side validation and authorization checks, rate and abuse controls on login, safe error messages, and no secrets in source code. MFA for admin sign-in is not in the SOW, because Annexure F's MFA applies to provider accounts.
- Performance (A15): no response-time or uptime figure is committed for Phase 1.
- Timeline: admin panel UI is delivered in Milestone 2 (weeks 2 to 4) and admin core in Milestone 3 (weeks 4 to 6). The final release gate in Annexure C, C3 includes 'agreed admin operations validated'.
- Acceptance: screens are accepted against the Milestone 1 designs (A18, Section 9.1), so what is shown in those designs becomes the reference. No Severity 1 or 2 Defects may remain open at final Acceptance (Section 9.5).
- Handover (A17): the administration guide covers officials and offices, jurisdictions, sources, corrections and alerts.

## 26. Traceability to the SOW and Service Agreement

| Screen or module | Basis | Milestone |
|---|---|---|
| Login, forgot and update password, sessions | A3, A9 (authenticated access, least privilege, secure sessions, logout), Annexure F | M2 UI, M3 core |
| Dashboard | Not a SOW module. Counts of A9 queues only, within the limit in A12 | M2 |
| Civic Cards | A7 card content, A9 records, UC-09. A view over existing records | M2 UI, M3 core |
| Officials | A7, A8, A9, UC-04, UC-09 | M2 UI, M3 core |
| Offices | A7, A8, A9, UC-04, UC-09 | M2 UI, M3 core |
| Jurisdictions | A8, A9, A19, UC-09 | M2 UI, M3 core |
| Corrections | A5, A9, UC-08, UC-10 | M2 UI, M3 core |
| Services & Resources | A7, A9 | M2 UI, M3 core |
| Sources | A8, A9, Section 4.4, A17 data documentation | M2 UI, M3 core |
| Alerts | A9, A10, UC-07 | M2 UI, M3 core |
| Admin Users | A3 ('granted permissions'). A20 excludes staff role-based access, so written confirmation is needed first | M2 UI, M3 core |
| Account menus, My Profile | A9 (secure sessions, logout) | M2 |

Anything beyond this table is a Change under Section 10.1. It needs a signed Change
Order before work starts (10.3, 10.4), and work directed without one is still paid for.

## 27. Data on every screen: what it means and why it is shown

Every tile, column and panel below has a definition and a reason to be on the screen.
Anything that had no clear purpose has been replaced. The tiles in sections 8, 9, 10 and 11
now match this section.

### 27.1 Rules for all screens

- Every number is a count of real records and opens the list filtered to exactly those records.
- Counts use active records only, unless the label says otherwise.
- Every date says what it is. 'Last updated' is the last change to the record's data, whether from the source or an admin. 'Last validated' is when an admin last confirmed a service entry. 'Submitted date' is when the resident sent the correction.
- Freshness is 'May be outdated' when today minus 'Last updated' is more than the source's 'Mark as outdated after (days)', unless an override sets it. Otherwise it is 'Current'.
- A field with no value stays blank. It never shows 'N/A' or placeholder text.
- The Figma mockups use realistic sample data: real-style names, titles, offices, jurisdictions and dates, with different values in each row. Lorem Ipsum, ABC-123 and repeated values are replaced.
- Thresholds below (90 days for terms ending, 180 days for service validation) are proposed and can be changed.

### 27.2 Dashboard

| Item | Definition | Why it is shown |
|---|---|---|
| Pending corrections | Corrections with status Pending or In Review. Subtext: days since the oldest was submitted | How much review work is waiting and how long the oldest has waited |
| Records may be outdated | Active officials, offices and jurisdictions with freshness 'May be outdated' | How much data needs re-checking against its source |
| Source issues | Sources whose status is Overdue or Failed | Explains why records are going stale and where to look |
| Alerts needing attention | Alerts sent in the last 7 days with failed or partly failed delivery | Flags messages that did not reach residents |
| Totals strip | Active officials, offices, jurisdictions and services | Gives the size of the data set |
| Needs attention table | Open corrections, outdated records, failed sources and failed alerts, oldest first | One work list, so nothing is missed |
| Recently edited records | The last ten changes: record, action, admin, time | Edits go live at once, so this shows what changed, by whom and when |
| Pilot coverage panel | One row per pilot jurisdiction: boundary OK or Missing, active offices, freshness | Phase 1 is limited to the pilot set (A19), so this is the launch-readiness check |

### 27.3 Civic Cards

| Item | Definition | Why it is shown |
|---|---|---|
| Jurisdiction | The jurisdiction the card is for | Identifies the card and opens it |
| Level, Parent | Government level, and the jurisdiction above it | Shows where it sits and lets the admin filter by state or county |
| Offices | Active offices in the jurisdiction | The size of the card |
| Vacant offices | Active offices with no active official | Offices residents see without an officeholder, to be filled or confirmed |
| Services | Active services linked to the jurisdiction or its offices | Shows whether residents get useful links |
| Oldest update | The earliest 'Last updated' among the card's active records | Shows how stale the card's oldest data is |
| Freshness | 'May be outdated' if any of its records is | One-glance health of the card |
| Coverage | Complete when the jurisdiction has boundary data and at least one active office, otherwise Partial (proposed rule) | Matches the coverage notice residents see (A7) |
| Status | Active or Retired | Retired cards don't show to residents |
| Card screen | The card as residents see it, with the fields listed in A7 | Lets the admin check exactly what residents read before and after an edit |

### 27.4 Offices

| Item | Definition | Why it is shown |
|---|---|---|
| ID | Short unique reference | Used in search, corrections and support |
| Office name | The office's official name | What residents read on the card |
| Level, Office type | Government level; Elected, Appointed, Department or Commission | Groups the office on the card (A7) |
| Jurisdiction, District or seat | Where the office applies, and the seat ID where provided | Decides which residents see it |
| Current official | The active official, or 'Vacant or unknown' | Shows gaps; the office stays visible (UC-04) |
| Email or contact page, Website, Address | Public contact details as published by the source | Shown on the card (A7) |
| Source, Last updated, Freshness | Where the data came from, when it last changed, Current or May be outdated | The provenance residents see (A7) |
| Status | Active or Retired | Controls whether residents see it |
| Tile: Active offices | Offices with status Active | Size of the data set |
| Tile: Vacant offices | Active offices with no active official | Offices to fill or confirm |
| Tile: May be outdated | Active offices with freshness 'May be outdated' | Offices to re-check |
| Tile: Missing contact details | Active offices with no website, phone or email or contact page | Residents can't reach these offices from the card |

### 27.5 Officials

| Item | Definition | Why it is shown |
|---|---|---|
| ID | Short unique reference | Used in search and corrections |
| Name, Title | The person and role as published | Shown on the card (A7) |
| Office, Level, Jurisdiction, District, Office type | Inherited from the office | Shows where the official appears |
| Phone, Email, Website, Office address | Public contact details as published | Shown on the card (A7) |
| Term end | The date the current term ends (added to the list; proposed) | Shows upcoming changes of officeholder |
| Source, Last updated, Freshness | As for offices | Provenance residents see |
| Status | Active or Retired | Controls visibility |
| Tile: Active officials | Officials with status Active | Size of the data set |
| Tile: Terms ending within 90 days | Active officials whose term end is within 90 days | Records likely to change soon |
| Tile: May be outdated | Active officials with freshness 'May be outdated' | Records to re-check |
| Tile: Missing contact details | Active officials with no phone, email or website | Residents can't reach them from the card |

### 27.6 Jurisdictions

| Item | Definition | Why it is shown |
|---|---|---|
| Name, Level, Parent | The jurisdiction, its government level and the one above it | Builds the hierarchy (A9) |
| District or seat ID | The identifier the source provides | Appears on the card where available (A7) |
| Child jurisdictions | Direct children | Shows how the hierarchy is built |
| Officials, Offices | Active counts within the jurisdiction | Shows whether it is covered |
| Boundary | OK when boundary data is loaded, Missing otherwise | Without a boundary, residents can't be resolved to it and see a coverage notice |
| Pilot | Whether it is in the pilot set (proposed) | Phase 1 is limited to the pilot set (A19) |
| Last updated, Freshness | As for offices | Provenance |
| Description | An internal note | Tells similarly named jurisdictions apart |
| Tile: Active jurisdictions | Jurisdictions with status Active | Size of the data set |
| Tile: Missing boundary data | Active jurisdictions whose boundary is Missing | Residents there get a coverage notice |
| Tile: No linked offices | Active jurisdictions with no active office | Empty cards |
| Tile: May be outdated | Active jurisdictions with freshness 'May be outdated' | To re-check |

### 27.7 Corrections

| Item | Definition | Why it is shown |
|---|---|---|
| Record type, Record | What the resident reported on, linked | Gets the admin to the record quickly |
| Field, Current value, Proposed value | The field concerned, what is stored, what the resident suggests | Lets the admin compare in one line |
| Description | The resident's own words (UC-08) | Explains the issue where no field was chosen |
| Submitted by | Display name and account ID | Accountability, with no further personal data (Section 13.2) |
| Submitted date, age | When it was sent and how many days ago | Orders the queue by waiting time |
| Evidence | A link the resident supplied | Lets the admin verify it |
| Status, Decided date | Pending, In Review, Applied, Dismissed, and when decided | Tracks workflow and history |
| Tile: Pending, In Review | Open corrections by status | Current workload |
| Tile: Applied and Dismissed (last 30 days) | Decisions in the last 30 days | Recent throughput and outcomes |

### 27.8 Services & Resources

| Item | Definition | Why it is shown |
|---|---|---|
| Name, Category, Description | The service, its category and plain-language description | Shown to residents (A7) |
| Linked office, Jurisdiction | Where the service applies | Decides which card shows it |
| URL or contact | The official link, phone or email | How residents reach the service (A7) |
| Last validated | When an admin last confirmed the entry | Shows how far to trust the link |
| Status | Active or Inactive | Controls visibility |
| Tiles | Total, Active, Inactive, Needs validation (not validated for 180 days) | Size of the list and what to re-check |

### 27.9 Sources

| Item | Definition | Why it is shown |
|---|---|---|
| Name, Type, URL | The source, how it is read, and where | Identifies where data comes from (A8, A9) |
| Coverage | Levels or jurisdictions it feeds | Shows which cards depend on it |
| Refresh method, Schedule | How and how often it is collected | A9 asks for the refresh method |
| Last successful refresh, Last attempt | Date and time | Shows whether collection is working |
| Status | Healthy, Overdue, Failed, Paused | Tells the admin which sources need attention |
| Records using | Records pointing to the source | Shows how many records go stale if it fails |
| Outdated after (days) | The freshness rule for its records | Drives freshness (A9: freshness metadata) |
| Tiles | Total, Healthy, Overdue or failed, Paused | Health of the collection |

### 27.10 Alerts

| Item | Definition | Why it is shown |
|---|---|---|
| Title, About | The alert and the office or official it concerns | Identifies it (A9) |
| Channels | In-app, Email, Push | What was chosen (A9) |
| Status | Draft, Sent, Partly failed, Failed | Tells the admin whether it went out |
| Audience | Followers reached at send time | How many residents it was meant for |
| Delivered, Failed | Counts across channels | Delivery status (A9) |
| Sent by, Sent date | Admin and time | Accountability |
| Tiles | Total, Sent in the last 7 days, Drafts, Failed or partly failed | Recent activity and problems |

### 27.11 Admin Users

| Item | Definition | Why it is shown |
|---|---|---|
| Name, Email, Role | Who the user is and what they can do | Access control |
| Status | Invited, Active, Deactivated | Shows who can sign in |
| Last login | Date and time | Spots unused accounts to deactivate |
| Created by, Created date | Who added them and when | Accountability |
| Tiles | Total users, Super Admins, Admin / Staff, Invited | Access overview |

## 28. Items to confirm with QubaLink

1. Jurisdiction retire: A9 lists create and edit only, but UC-09 says retired. Confirm retire is included.
2. Admin Users and two fixed roles: confirm this sits within A3 and A9, not A20's exclusion of staff role-based access.
3. Seats: confirm that a multi-member body is modelled as one office per seat, with one active official each.
4. Service categories: a fixed list, or editable by the Super Admin?
5. Resident notice on corrections: should a resident be told when their correction is applied or dismissed? The SOW doesn't say.
6. Proposed items: pilot flag, coverage note, boundary overlap note, source refresh history and Refresh now, alert drafts, notification preferences, preset dismissal reasons, and the password, lock and session rules (12 characters, 5 attempts, 15-minute lock, 30-minute idle timeout, 60-minute reset link, 7-day invite).

Added after checking every screen against the SOW and the Service Agreement:

- Correction form: UC-08 says the resident 'describes the correction'. Confirm what the resident form captures (the record, an optional field, a description, an optional proposed value and evidence link), so Apply can update a record directly when a field and value exist.
- Resident data in the panel: we show the submitter's display name and account ID only (Section 13.2). Confirm admins don't need the resident's email.
- Overrides and refresh: confirm that an automated refresh doesn't overwrite an override, and that a 'Source changed since override' flag is wanted.
- A16 and A9: A16 lists the admin panel as officials, jurisdictions, corrections, sources and alerts, while A9 also covers offices and services. This spec builds all of them, as A9 describes.
- Admin on small screens: the panel is responsive (Section 3.4). Confirm whether phone use of the admin is expected.
- Admin sign-in security: MFA isn't in the SOW for admin sign-in. Confirm email and password only.
- Analytics link: a link from the Dashboard header to the analytics provider's dashboard (A12), and times shown in the admin's browser time zone.
