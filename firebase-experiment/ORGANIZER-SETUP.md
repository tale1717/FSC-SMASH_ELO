# Invite-only organizer access

No sign-up or access-request UI exists. Email/password accounts are created manually by the owner in Firebase Authentication → Users → Add user. Enable Email/Password under Sign-in method first. Google remains enabled for the owner's existing account.

The Worker enforces Google sign-in for OWNER_UID and email/password sign-in for every approved organizer. It checks the verified token's current sign_in_provider; linking Google to an organizer account does not permit organizer access through Google. Other people can still complete Google's authentication screen and may create a Firebase user, but cannot obtain organizer access through Google.

A Firebase account is not an organizer permission. Hidden signup buttons do not disable Firebase's public signup API. The Worker checks an owner-managed UID allowlist, so any account created outside this process has no organizer access.

## Deploy the API

In Cloudflare, open fsc-smash-elo-api → Edit code. Replace Hello World with cloudflare-worker/worker.mjs and deploy.

Under Settings → Variables and Secrets configure:
- OWNER_UID: 76XXWSwa4FgMRHAp01Aa13qrfLn1
- FIREBASE_WEB_API_KEY: the current apiKey from the Firebase web app configuration in project fsc-smash-elo. Do not use an old deleted app configuration or a service-account private key.
- ORGANIZER_UIDS: comma-separated UIDs of approved accounts; omit until adding other organizers.

If the web API key has browser referrer restrictions, use a separate project API key limited to the Identity Toolkit API for server requests instead of weakening the browser key. Do not paste API keys or tokens into chat.

The Worker forwards the Firebase ID token to Google's accounts:lookup endpoint to verify it and check the account, then checks project claims, disabled/revoked state and the approved UID list. Never authorize from a UID supplied by the browser. No GitHub token is required at this stage.

## Add an organizer

1. Approve the person first.
2. Create their email/password account in Firebase Authentication.
3. Copy its UID from the Firebase console and add it to ORGANIZER_UIDS in Cloudflare.
4. Provide their credentials privately. Use Firebase's password reset flow to let them choose their own password.
5. They sign in at /organizer.html. There is no public request or registration flow.

To revoke access, remove the UID from ORGANIZER_UIDS immediately and disable the account in Firebase. Keep the existing owner account; do not delete/recreate it, as that changes its UID.

Deploy Hosting after pulling test-firebase. Sign in with Owner Google sign-in and verify "Owner access confirmed." New organizer accounts use email/password. An unapproved account must see access denied.

Active-match reads now use the Worker directly, without GitHub dispatch latency. Final result approval and player rooms are not implemented. Existing Firestore rules and Elo remain unchanged. Future privileged endpoints must reuse this server-side authorization on every request.

Tests: node --test cloudflare-worker/worker.test.mjs


## Active matches

Add CHALLONGE_API_KEY as a Cloudflare secret using the existing Challonge account API key. The Worker uses v2.1 endpoints with Authorization-Type: v1, exactly like the existing Python importer. Never put this key in public files.

Redeploy the full worker.mjs in Cloudflare and deploy Firebase Hosting after pulling this branch. No bindings, GitHub token, or Firestore rule changes are required.

Sign in, click Load / reload tournaments, select the active bracket, then Refresh matches from Challonge. The list is restricted to in-progress tournaments named with the FSC Fall Bracket prefix, game Super Smash Bros. Ultimate, no teams or group stages. No tournament currently running means an empty list, not a login failure. Start a bracket on Challonge first; don't start a real bracket merely to test this page.

GET /tournaments and GET /matches?tournament=NUMERIC_ID both enforce organizer identity and provider checks. Each refresh verifies the tournament is still in the account's active filtered list. Match and participant requests use its numeric ID. Open/underway sets with resolved opponents and no winner are shown; completed, pending, and unresolved sets are excluded. Unresolved counts are disclosed.

After manually entering a score on Challonge, click Refresh matches from Challonge again. This reads current data without writing scores, calculating Elo, or publishing game reports. There is no automatic polling. The UI clears old matches on a refresh failure instead of presenting them as current.

Pagination continues to an empty page, with duplicate checks and a 12-page cap per collection (maximum 36 Challonge requests per match refresh). It fails explicitly rather than serving a partial list. Responses are not cached. A 25-second deadline bounds Challonge reads.

Tests use mocked Google and Challonge responses; live access from Cloudflare must still be checked after deployment. A 403 from Challonge may reflect account permissions or a security block; never bypass it.
