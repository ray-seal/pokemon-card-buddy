# Pokémon Collection Tracker (National Pokédex, Gen I–IX)

Collections are local profiles stored in this device's browser storage (no sync across devices). Pokémon data is in `src/data/pokemon.js`, sourced from PokeAPI species data.

Dependency-free static app (ES modules, localStorage).

- Run: `npm start` then open http://localhost:8000
- Test: `npm test`

Structure: `src/data/pokemon.js` (reference data), `src/collection.js` (state), `src/filter.js` (search/filter/sort), `src/storage.js` (persistence), `src/main.js` + `index.html` + `styles.css` (UI).


## Cloud sync (testing branch)

Supabase project: `ojnpdosscasvolfhsreh` (London / `eu-west-2`).

- `src/cloud.js` contains the browser client, email/password sign-in and opt-in collection sync.
- `public.user_collections` stores per-account collection checklists; row-level security restricts each user to their own rows.
- `public.binders` is ready for binder metadata/page sync.
- Private Storage bucket `binder-photos` accepts JPEG, PNG, WebP and AVIF up to 10 MiB. Object policies require the first folder segment to equal the signed-in user's UUID.
- The client uses the Supabase publishable key only. Never add a service-role key to this repository.
- The PWA cache is versioned as v9. The Supabase SDK is loaded lazily so an unavailable network does not prevent the local app from starting.

### Current testing scope

Email/password account controls and opt-in checklist sync are wired in the testing branch. Checklist sync currently merges owned/wanted flags additively to avoid accidental data loss; clearing a flag on one device is not yet propagated as a deletion. Binder records and photo uploads have a secure backend schema/bucket but still need the UI sync/migration flow before binder photos are cloud-backed. Existing local data is not automatically uploaded; the user must choose Sync collection.

### Supabase dashboard setup for testing

In Authentication settings, set the Site URL to the deployed testing URL and add the testing and production app URLs to the allowed redirect URLs before trying email confirmation links. Confirm the email provider is enabled. Test with a new account before using any account containing valuable collection data.

### Database migration

The initial schema is documented at `supabase/migrations/202610270001_initial_schema.sql`. The migration was applied directly to the new Supabase project; the SQL file is kept in the repo so the setup is reproducible.


### Friends and collection-only sharing (testing branch)

The Friends tab uses a private 12-character friend code and accepted friend requests. There is no public user directory. Users can choose a preset avatar, then grant each accepted friend access to specific synced Pokédex collections. Sharing is off by default.

Only `user_collections` checklist rows can be shared. The app renders Pokémon names from its built-in Pokédex data; it does not render user-supplied images in friend profiles. Binder pages, binder metadata and the private `binder-photos` Storage bucket are not shared or changed by this feature.

Before testing this branch against Supabase, apply `supabase/migrations/202610280001_friends_collection_sharing.sql` after the existing migrations. This adds the friend-code lookup RPC, friend relationships, per-collection grants, rate limiting for friend-code attempts, and row-level security. Do not merge or launch this feature until the migration has been applied and tested with two separate test accounts, including verifying that an unshared collection and every binder/photo remain inaccessible to the other account.
