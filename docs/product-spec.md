# Frolf Tour Manager MVP

## Product Goal

Frolf Tour Manager is a publicly browseable web app for running amateur disc golf tours made up of independent local competitions. Verified users can organize their own competitions, admins manage system-wide settings, and tours aggregate final competition results into season standings.

## Core Roles

- `guest`: can browse tours, competitions, standings, and announcements.
- `user`: registered account with confirmed email.
- `organizer`: any confirmed user; organizers can create competitions and edit their own competitions.
- `admin`: manages tours, scoring systems, announcements, and user roles.

## Domain Rules

### Tours

- A tour represents one standings season or league.
- A tour has a name, season label, description, and a scoring configuration.
- Tours are public by default in the MVP.

### Scoring Configuration

- Each tour owns its own placement-based points table.
- The points table maps finishing place to awarded points, for example `1 -> 15`, `2 -> 12`, `3 -> 10`.
- The admin configures whether all competition results count or only the best `N` results count toward the season total.
- Lower numeric result values are treated as better results in the MVP because the reference workflow uses strokes relative to par.
- When a competition is finalized, the active scoring configuration is snapped onto the competition. Future edits to the tour scoring configuration affect only future finalizations unless an admin explicitly refinalizes a competition.

### Competitions

- A competition belongs to exactly one tour.
- A competition has a title, time, place, organizer, description, optional scoresheet URL, participants, and results.
- Competition lifecycle:
  - `draft`: organizer is still editing, not publicly shown in listings.
  - `published`: public competition page and participant list are visible.
  - `finalized`: final results are locked in for standings and points are awarded.
- A competition must have at least three participants before it can be published or finalized.
- Finalized competitions must include result rows for every participant.
- Results store:
  - placement
  - result value
  - awarded points
  - optional tie-break rank
  - optional tie-break note
- Organizers can edit their own competitions in any lifecycle state; finalized edits are recorded in an audit log and standings are recalculated from the latest finalized data.
- Admins can edit any competition.

### Competitors

- Competitors do not need accounts.
- Each tour has reusable competitor profiles so the same person can be matched across multiple competitions.
- Profiles are matched by normalized display name in the MVP, with admin tools to merge accidental duplicates.
- A competitor profile may optionally be linked to a user account later.

### Standings

- Only finalized competitions contribute to standings.
- For each finalized result, awarded points come from the competition's snapped scoring table.
- If a tour uses best-`N` counting, only a competitor's best `N` results count.
- When selecting counted results, higher awarded points win; ties are broken by the better result value.
- Season standings are sorted by:
  1. total counted points descending
  2. aggregate counted result value using the tour's result ordering
  3. best single counted result value
  4. display name

### Announcements

- Announcements are shown on the main page.
- Announcements can be global or attached to a specific tour.
- Only admins can create or edit announcements.

### Accounts And Verification

- The MVP uses email and password accounts.
- Accounts require confirmed email before the user can create competitions.
- The implementation exposes verification tokens in development responses so local testing works without a real mail service.
- If no admin exists yet, the first verified account is promoted to admin to bootstrap the system.

## Non-Goals For MVP

- Hole-by-hole scorecards.
- Live scoring.
- Automatic imports from external score services.
- File uploads for scoresheets.
- Complex moderation workflows.

## Initial Technical Shape

- `apps/api`: Express + TypeScript + MongoDB via Mongoose.
- `apps/web`: React + TypeScript + Vite.
- `packages/shared`: Zod schemas, shared types, standings logic, and permission helpers.
