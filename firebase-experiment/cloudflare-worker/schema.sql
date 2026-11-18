CREATE TABLE IF NOT EXISTS match_rooms (
  id TEXT PRIMARY KEY,
  tournament_id TEXT NOT NULL,
  match_id TEXT NOT NULL,
  code_a TEXT NOT NULL,
  code_b TEXT NOT NULL,
  state TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  UNIQUE(tournament_id, match_id)
);
