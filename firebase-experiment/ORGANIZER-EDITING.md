# Organizer results and exports

Deploy the website and Firestore rules from `firebase-experiment`:

```powershell
firebase deploy --only "hosting,firestore:rules" --project fsc-smash-elo
```

Copy `cloudflare-worker/worker.mjs` into the existing Cloudflare Worker and deploy. Keep the existing variables and MATCH_DB binding. No SQL migration is needed.

CSV exports are available from the main rankings page and organizer editor. Exports use the loaded public snapshot. They include all rankings, official rankings, sets, or recorded games; sets/games can be filtered by tournament. Unknown game details are not invented.

On the organizer page, load saved results, select a tournament or create a manual one, then enter completed sets. Set order is explicit and determines Elo replay. Enter game winners for every game if adding game details; unknown stages and characters may stay Unknown. Preview Elo, add a change note, then publish. Publication backs up the previous dashboard, records an audit entry, and uses a transaction to reject concurrent edits. Manual corrections are saved as source overrides so later importer runs preserve them. No Challonge connection is needed for these operations. Drafts can be saved in the current browser tab. This is result entry, not an automatic bracket generator.

The owner already has result-editing access after rules deployment. Additional organizers must have a Firebase password account, their UID in the Cloudflare ORGANIZER_UIDS variable, and result-editing access granted under the owner's Invite-only editing access panel. Revoke both permissions when removing an organizer. No self-registration or access-request flow is provided.

Room cards show player codes under their names for authorized organizers only. New rooms and reissued codes persist in private D1 state; player and lobby responses remove these fields. Legacy hashes cannot be reversed: reissue each legacy code once to display it. Reissue invalidates the previous code. A normal result remains visible until TO approval; approval removes it from active lists. The room card's Enter / edit result button copies the room into the editor. Publishing also closes that room. If players change the room concurrently, publication remains saved and room closure requests a refresh. An already-approved room remains archived in D1.

Requests: public ranking data is cached in session storage for 60 seconds across pages. Organizer refresh always fetches fresh results. Exports make no reads beyond loading the snapshot. Challonge lists are cached in each Worker isolate: tournaments 60 seconds, participants 5 minutes, matches 10 seconds; failed responses are not cached. Player polling starts at 10 seconds and slows while unchanged, pauses in hidden tabs, and stops after approval. Revision-only responses reduce response size; polling still requires a D1 read. No new user rate limits were added.
