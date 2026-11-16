# Organizer sign-in setup

This page establishes the organizer's Firebase identity only. It does not grant TO permissions, read private data, dispatch workflows, or write match results.

1. Enable Google under Firebase Authentication → Sign-in method.
2. Pull test-firebase and deploy Hosting from firebase-experiment.
3. Open /organizer.html on the hosted site, sign in, and copy the Firebase UID.
4. Configure the future Worker to verify Firebase ID tokens for project fsc-smash-elo and authorize that exact UID on every privileged request. Never use a client-side role check as authorization.

The UID may be shared for setup. Do not share ID tokens, passwords, client secrets, or GitHub tokens.
Sign-in uses session persistence and provides a sign-out button for shared TO computers.

The existing Firestore rules are unchanged. Google sign-in alone does not enable writes or organizer privileges. The Cloudflare Worker is still a separately deployed service; Hosting deployment does not deploy it.

If sign-in reports an unauthorized domain, add the hosting hostname under Authentication → Settings → Authorized domains. Test on the hosted URL first.

Manual check: sign in, confirm the displayed UID matches Authentication → Users in the Firebase console, copy it, then sign out and confirm the identity disappears.
