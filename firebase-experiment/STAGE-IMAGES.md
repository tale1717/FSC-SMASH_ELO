# Stage card images

The match demo now supports image-based strike cards, large X overlays for pending and confirmed strikes, and a selected-stage preview. The rules remain 1–2–1, then three bans, with no DSR.

Stage pictures have not yet been supplied. Until then each card shows an explicitly labelled placeholder; a missing image does not prevent striking.

Add the user's images to public/assets/stages with these filenames:
- pokemon-stadium-2.jpg
- small-battlefield.jpg
- battlefield.jpg
- town-and-city.jpg
- smashville.jpg
- final-destination.jpg
- kalos-pokemon-league.jpg
- hollow-bastion.jpg

If images use a different format, update stageImages in public/match-demo.html to match their actual extensions. Do not merely rename PNG bytes to JPG. Cards use 16:9 crops with object-fit: cover.

This is still a one-device demo, not live player rooms. Struck states are shown with both text and X overlays. Keyboard Space/Enter can select cards; focus is preserved after selection.
