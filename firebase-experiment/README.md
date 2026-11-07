# FSC Firebase experiment

Project: `fsc-smash-elo`. Branch: `test-firebase`.
This directory is a separate implementation; the original Java/Django/MySQL application
is untouched. Nothing here has been deployed or imported into the live project yet.

## What is included

- Static Firebase Hosting website: rankings, player search, head-to-head and set history.
- Python importer using the Google Cloud Firestore client with Application Default Credentials.
- A public `public/dashboard` document with the complete published season snapshot.
- Private `importSources/{tournamentID}` documents containing only event metadata, names,
  and set results needed to reproduce ratings. API responses with personal account fields
  are not saved.
- Firestore rules permit anyone to get the dashboard and prohibit all client writes and
  access to source documents. Server access is controlled separately by IAM.
- Test workflow and a manually triggered preview/publish workflow. No automatic daily
  schedule is enabled yet.

## Import behavior and limits

The four required initial brackets are `3gee2mio`, `ezus0cc3`, `knpl9s22`, `yt30nf6m`.
Later events must be completed, start after all four initial events, match the game ID
of #4, and have a title beginning `FSC Fall Bracket`. This prefix applies to future years
too: decide on a season rollover before importing a later Fall season.
Only singles without group stages are supported. All four seed brackets must remain
visible to the organizer's API key. Missing initial events abort the import.

Each run lists the account's tournaments; a publish fetches participants and matches for
uncached events. Set `refresh` to true to refetch already imported events after corrections.
Without refresh, changes to saved set results are not detected. Missing cached events
in the selection cause a stop for review, not automatic deletion.

Ratings are rebuilt in event start-time order, then event ID. Within each event, sets
use `suggested_play_order`, with match ID as fallback/tiebreaker. Starting Elo 1000,
K=64, with the original score-margin adjustment and corrected fractional arithmetic.
At equal ratings, 2-0 transfers 64 points; 3-1 transfers 43; 3-2 transfers 22.
This is the policy from the Java draft, not an official Smash rating standard.
Confirm this policy before the first publish.

Byes, unfinished sets, blank scores, ties and negative-score DQs are excluded.
Use one set score such as `2-1`; unsupported score formats stop the import.
A DQ entered as a regular 2-0 cannot be distinguished from a played set.
Player names are exact and case-sensitive after trimming. Sponsor tags are preserved.
Map name variants in `aliases.json` as `{"Old tag":"Canonical tag"}`. Alias changes
replay all saved results; they do not use the legacy weighted-average merge behavior.
Review matching before publishing. Do not merge two actual opponents into one identity.

The importer computes everything before writing. One Firestore transaction writes all
new sources and the dashboard together. It checks the previous revision so overlapping
publishers cannot silently replace each other. A repeated identical import makes no writes.
The experiment refuses snapshots over 750 KB (below Firestore's document limit) or more
than 400 source updates in one transaction. Split the storage model before outgrowing
these bounds. Each website load fetches one dashboard document; no live listener is used.
The snapshot exposes all published names and match history publicly.

## Local tests

Python 3.12:

```sh
python -m unittest discover -s firebase-experiment/tests -v
```

The 12 tests cover selection, missing seeds, unsupported groups, DQs, inconsistent winners,
Elo values, zero-sum replay, duplicate events, aliases and document size guards.
They do not test real Challonge responses, Firestore transactions, deployed security
rules or Firebase Hosting. Those live checks remain necessary.

## Upload these files to the branch

The experiment ZIP contains `firebase-experiment/` and `.github/workflows/`.
Extract its contents at the root of your checkout of `test-firebase`, preserving the
hidden `.github` directory. Commit only those files to that branch. The existing
application is not replaced. GitHub integration write access was unavailable during
preparation, so no remote commits were made by the assistant.

## First setup: rules and website

1. Keep the existing `(default)` Standard edition Firestore database in production mode.
2. In Firebase Console → Firestore → Rules, replace the starter rules with this directory's
   `firestore.rules` and publish them. This intentionally exposes only the dashboard.
3. Install Node.js LTS and the Firebase CLI on your own computer:
   `npm install -g firebase-tools`, then `firebase login`.
4. From `firebase-experiment`, run:
   `firebase deploy --only hosting --project fsc-smash-elo`.
   This publishes the site; rules can alternatively be deployed with `--only firestore:rules`.
5. Open the Hosting URL printed by the CLI. Until the first import it should say no
   tournaments have been imported. Never deploy the repository root as the public folder.

`public/firebase-config.js` is the user-provided public web configuration. Its Firebase
API key is not an administrative credential. Do not put Challonge credentials or a
service-account private key into this folder.

## Preview first (no Google credentials required)

In GitHub repository Settings → Secrets and variables → Actions:

- Add a repository **secret** `CHALLONGE_API_KEY` with the organizer's API key.
- Add a repository **variable** `FIREBASE_IMPORT_ENABLED` with the value `true`.

Keep `import-request.json` at `"mode":"preview"`. Increment `request` and commit the
change to `test-firebase`. This triggers a preview listing the selected tournaments,
without opening Firestore. Check all names and dates in the Actions log.

The push trigger is provided because `workflow_dispatch` is only discoverable normally
once that workflow is on the default branch. Do not merge merely to enable manual runs.

The importer currently uses the original Challonge API v1. That API is deprecated;
confirm the organizer account still has access. Check the account's request allowance.
A normal run uses one list request plus two per newly imported event. A full refresh
uses two per selected event. Avoid frequent full refreshes.

## Give GitHub permission to publish (no downloaded private key)

Use a dedicated service account, for example `fsc-elo-importer`, in Google Cloud IAM for
project `fsc-smash-elo`. Grant it `Cloud Datastore User` (`roles/datastore.user`) on this
project. This role is privileged across this project's database, which is why the
project should be dedicated to Elo. Do not grant Owner or Editor.

Configure a Workload Identity Pool and OIDC provider for GitHub:

- Issuer: `https://token.actions.githubusercontent.com`
- Map `google.subject=assertion.sub`, `attribute.repository=assertion.repository` and
  `attribute.ref=assertion.ref`.
- Restrict the provider condition to
  `assertion.repository == 'tale1717/FSC-SMASH_ELO' && assertion.ref == 'refs/heads/test-firebase'`.
- Grant `roles/iam.workloadIdentityUser` on the service account to the pool principal set
  restricted to `attribute.repository/tale1717/FSC-SMASH_ELO`.
- Enable the IAM Service Account Credentials API if requested. Do not upgrade billing
  solely because a generic console prompt suggests it; stop and review any billing request.

In GitHub Actions repository variables, add:

- `GCP_WORKLOAD_IDENTITY_PROVIDER`: the full provider resource name returned by Google,
  `projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/POOL/providers/PROVIDER`.
- `GCP_IMPORT_SERVICE_ACCOUNT`: the dedicated service account email returned by Google.

These are identifiers, not private keys. The `google-github-actions/auth` step creates
short-lived credentials. The Python Google Cloud client is used directly; this project
is not relying on Firebase Admin SDK support for federated credentials.

After preview succeeds, change the request mode to `publish`, increment `request`, and
commit to `test-firebase`. Verify counts, player identities and sample ratings, then
repeat the same publish and confirm the log says no writes. Check anonymous browser
access to `public/dashboard` succeeds and all browser writes/private reads fail.
Test rollback and concurrent publication against a disposable test project before
calling this production-ready.

## Daily scheduling comes after validation

GitHub scheduled workflows run on the default branch. For this branch-only experiment,
use the request file or manual dispatch where available. After reviewing and merging,
update the workflow branch guard and the OIDC provider condition to the approved default
branch, then add a daily schedule (for example `17 11 * * *` UTC). Add an explicit schedule
mode of `publish`; do not rely on a leftover preview request. GitHub schedules may be
delayed and public repository schedules are disabled after 60 days of inactivity.

References:
- https://firebase.google.com/docs/firestore/security/get-started
- https://github.com/google-github-actions/auth
- https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows
- https://challonge.apidog.io/
