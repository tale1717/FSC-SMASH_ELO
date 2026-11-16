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

This step implements identity and approval checks only. Active-match refresh, GitHub dispatch, and final result approval endpoints are not implemented. Existing Firestore rules and Elo remain unchanged. Future privileged endpoints must reuse this server-side authorization on every request.

Tests: node --test cloudflare-worker/worker.test.mjs
