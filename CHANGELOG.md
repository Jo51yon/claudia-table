# Changelog

Semantic versioning: MAJOR = a prop, exported type, or default behaviour changed in a way that
could break an existing consumer without any code change on their side. MINOR = additive only.
Consuming projects should pin to a tag (`#v1.0.0`), never `#main`.

## v1.1.0 — 2026-08-20

Additive. Adds `copy` -- 8 previously hardcoded strings now overridable, including
`rangeSummary`, a real function (not a static string) so the "1-25 of 140" format itself can
be restructured, not just translated word-for-word. Every existing consumer unaffected.

## v1.0.0 — 2026-08-20

First release. `ClaudiaTable` -- extracted from Lintel's real `DataTable.jsx`, which its own
source comment already treated as a shared component within Lintel itself ("built once, used
by every table in the app"). Server-side pagination, sort, search, filters, URL-persisted
state, CSV export, mobile-responsive layout -- real, working logic, not rewritten from
scratch.

Two real modes (`server` | `client`), not one forced shape: checked PETGI's real
`TopicsPanel.tsx` before deciding this, not assumed. PETGI sorts an already-fetched in-memory
array client-side -- the right choice at its real scale; Lintel does real server-side
pagination -- the right choice at its real scale. Forcing either onto the other's architecture
would have been a real regression, not a reuse win.

`fetchPage` is dependency-injected in server mode, not a hardcoded `@supabase/supabase-js`
call -- this package has zero opinion on the data layer.

Real bug caught by actually building, not assumed correct: the props type was first written
as an `interface` combined with `&` intersection syntax for the discriminated union, which
TypeScript does not allow on interfaces (only type aliases) -- fixed before this tag.

**Known consumers at this tag:** none yet at release.
