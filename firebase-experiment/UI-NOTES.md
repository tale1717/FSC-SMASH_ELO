# Player pages and character icons

Deploy from `firebase-experiment` with `firebase deploy --only hosting --project fsc-smash-elo` after pulling `test-firebase`. Keep the existing local `public/firebase-config.js`; it is intentionally not committed.

Rankings link to `player.html?id=PLAYER_ID`. The Set History and Head-to-Head tabs also support `#history` and `#h2h` links. Each event is grouped by its bracket number, with date used as a fallback. Match order within an event stays as published by the importer. These pages only read `public/dashboard`; they do not change ratings or write to Firestore.

`public/stock-icons.js` stores the 39 exact player assignments from the supplied spreadsheet. PNGs are stored locally in `public/assets/stock-icons`, preserving the costume variants and source filenames. `SOURCES.md` records their original URLs. Unknown players have no image rather than a guessed character.

Two sheet names need confirmation before mapping to different live tags: `Negative_` and `stigz`. YorkNew and YouGotMail have no assignment in the sheet. Case and punctuation are matched exactly; icon assignments never merge player identities.

The school esports logo is pending the actual image. The forest-green theme preserves the 1080px maximum page width and original rankings padding. Icons are overlaid in the existing rank/name gap at a shared center, allowing double-digit ranks without adding a column.

The browser checks use synthetic data and mock Firebase modules, with no production credentials or database calls. Run with Node and Playwright installed: `node firebase-experiment/tests/browser.cjs` from the repository root.
