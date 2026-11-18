# Live match rooms

The organizer loads open Challonge sets and creates one shared room per set. Players can choose their set on `match.html`, or use the same room link. Each player receives a different private six-digit code. Players join from their own device; only their own character choice, stage turn, game report and final confirmation are accepted. Both game reports must agree before advancing. Both players confirm the final result before the TO approves it.

Results stay in Cloudflare D1. The TO still enters the official score on Challonge. This feature does not write Elo or Challonge scores. Stage/character history is stored in the room; publishing that history to player analytics is a separate integration.

## One-time Cloudflare setup

1. Create a D1 database named `fsc-smash-matches` in Cloudflare under Storage & databases → D1.
2. Open its Console and run the SQL from `cloudflare-worker/schema.sql` to create the table.
3. Open the `fsc-smash-elo-api` Worker → Bindings → Add binding → D1 database. Set the binding name exactly to `MATCH_DB` and select `fsc-smash-matches`.
4. Keep the existing `FIREBASE_WEB_API_KEY`, `OWNER_UID`, `CHALLONGE_API_KEY` and any `ORGANIZER_UIDS` settings.
5. Replace the Worker code with the complete contents of `cloudflare-worker/worker.mjs`, then deploy it.
6. Pull branch `test-firebase` locally. In PowerShell, deploy Hosting from the Firebase folder:

```powershell
cd "C:\Users\David T\IdeaProjects\FSC-SMASH_ELO\firebase-experiment"
firebase deploy --only hosting --project fsc-smash-elo
```

No new Firebase Authentication provider or Firestore rules are needed for match rooms. Organizer authentication remains invite-only; players use private codes.

## Dummy tournament

Create a singles, single-stage Super Smash Bros. Ultimate tournament named exactly **FSC Test Bracket**. Add at least four dummy entrants and start the bracket. It must be in progress and accessible to the configured Challonge account. Four entrants allow testing multiple open sets.

The Elo importer rejects tournament names containing the words test, dummy or practice, including completed test events. Keep the test name. For permanent exclusion even if renamed, add its numeric ID and/or URL slug to `excluded-tournaments.json` before completing it. Never use one of the real seeded tournament URLs for a test.

In the Organizer page, load tournaments, select the test bracket, and refresh matches. All open sets with known opponents are listed. Choose Best of 3 or Best of 5 and create a player room. Give each player only their own six-digit code. Existing 24-character codes continue working until reissued. Use Reissue for each player to replace old codes with six-digit numbers. No failed-attempt limits are applied. Codes are shown after creation or reissue, stored hashed on the server, and expire after 48 hours. Reissue replaces that player's old code.

Players' pages refresh every five seconds while visible. The TO manually refreshes rooms to review confirmations and approve a result. After approval, manually enter the score in Challonge and refresh matches to see newly available sets. Approval on this site alone does not advance Challonge.

If players agree on the wrong final game, the TO can choose Correct final game before approval. This reopens that game and requires new player confirmations. Earlier-game editing is not included yet.

## Checks

```sh
node --test firebase-experiment/cloudflare-worker/worker.test.mjs firebase-experiment/cloudflare-worker/rooms.test.mjs
node firebase-experiment/tests/live-rooms.cjs
python -m unittest discover -s firebase-experiment/tests
```

The room API tests use SQLite with real SQL and mocked external authentication/Challonge responses. The browser test uses two isolated player sessions through the actual room handler. Node 22 or newer with node:sqlite is required for these tests.

