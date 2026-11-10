# Player game records

Stats and set.html use confirmed game reports, joined by both tournament ID and match ID. Historical sets without details retain their Elo and official scores; no characters or stages are inferred from stock icons. All published results continue to come from Challonge.

The reviewed source is game-reports.json. It is initially empty. An organizer with repository write access can add verified historical reports and run the existing importer. Each report has string tournament and match IDs, status "confirmed", and ordered games. Each game has number (starting at 1), stage, winner (canonical dashboard player ID), and characters (mapping both dashboard player IDs to their played character names). These are game-level selections, not profile mains.

The importer validates totals, participants, game order, and early set completion. A conflicting report is published as needs-review without game details and excluded from stats. It does not overwrite Challonge or alter Elo. Re-running an import reloads the reports from their separate source, preserving details across replay. Renamed/merged player IDs require organizer review of affected reports. Existing snapshot size limits still apply.

Player self-reporting is NOT enabled. Before enabling it, configure Firebase sign-in, verified player-to-account assignments, organizer privileges, the approved stage/character lists, and an opponent-confirmation flow. Store drafts separately from public confirmed reports. Never allow client writes to public/dashboard or trust a client-supplied confirmed status. No anonymous form or demo records are shipped as live reporting.

Deploy with the existing Firebase Hosting command after pulling test-firebase. No Firestore rules changes are needed for these read-only views. The next authorized importer run can publish reviewed game records; deploying Hosting alone never changes ratings or data.
