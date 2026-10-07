# Global score storage

This build stores global expedition results in `public.ularn_scores` in the **Games → ularn3d** Supabase project (`rysazeizsuefshazbwyh`). Online room scores retain the existing `scores`, `runs`, and authenticated replay-submission function. Solo/classic expedition records use the append-only `ularn_scores` table. Solo/classic records are client-reported. Online room results continue to be replay-verified and are not duplicated into the solo table.

Eligible completed runs save locally first, then upload through Supabase's Data API. The original eligibility rules retain winners, positive scores, or expeditions lasting more than five mobuls; wizard/cheater runs are excluded, and debug runs are kept local. Death or victory creates a result; manual saves preserve the expedition rather than submitting a score.

`common/score-service.js` captures an immutable upload immediately. Per-run local storage keys retain offline or failed submissions across reloads. Reconnection and startup flush them; transient errors retry with delays from 30 seconds to five minutes. A successful response removes only that run's queue key. Inserts ignore duplicate `(edition, game_id)` keys, so concurrent retries cannot overwrite a result. Queue errors and pending uploads are visible in the scoreboard.

3D and classic runs use separate edition filters. Winners sort by difficulty, then time used and score. Visitors sort by difficulty, score, then time survived. Each group reads at most 72 results. The menu, `z`, and end-of-expedition board use the same service; local records remain available independently.

## Configuration

`scoreboard.config.json` holds the public project URL and publishable key. Both are intended for browser and desktop clients. Optional `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` values override them; `.env.local` is ignored by Git. Builds generate `public/engine/score-config.js` and `.json`, copied into `dist`. The build rejects secret and service-role keys. No privileged credential is bundled.

The migration in `supabase/migrations/20261007111140_ularn_global_scores.sql` was applied to the Games project. RLS permits public reads and constrained inserts. Clients cannot update/delete results or supply server timestamps. Database constraints bound names, numeric fields, classes, and detail size. Ranking indexes match the two board queries.

Scores include the player name, class, difficulty, score, outcome, location, move count, game time, and final game details/logs. IP addresses, browser metadata, and player tracking IDs are excluded. The desktop CSP and request filter permit only this project's score-table path and GET/POST/OPTIONS methods; unrelated remote requests remain blocked.

## Verification

Run `npx playwright test tests/scoreboard.spec.js` with the development server running. These tests use an intercepted Supabase database and cover automatic submission, visibility in a second browser profile, offline/reload retries, local records, details, pagination, malformed/unavailable responses, timeout, stale responses, and escaped names. Ending fixtures in other tests intercept submissions to avoid writing test scores to the live database.

`node --test tests/desktop-protocol.unit.mjs` verifies the desktop allowlist. `npm run test:desktop` exercises the packaged web build and desktop score requests. Live verification additionally checks public insert/read, duplicate handling, update/delete denial, and a score saved by the actual game then read in a separate browser profile. Temporary verification records are removed afterwards.

Seeded deterministic replay sessions retain the native rules and RNG stream; local solo lemming adapters apply only to ordinary unseeded 3D expeditions.
