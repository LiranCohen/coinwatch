CREATE TABLE IF NOT EXISTS identities (
  did TEXT PRIMARY KEY,
  handle TEXT,
  reputation INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS challenges (
  nonce TEXT PRIMARY KEY,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  did TEXT NOT NULL REFERENCES identities (did),
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  txid TEXT NOT NULL UNIQUE,
  detected_at TEXT NOT NULL,
  rules TEXT NOT NULL,
  value_sats INTEGER NOT NULL,
  inputs TEXT NOT NULL,
  outputs TEXT NOT NULL,
  ai_status TEXT NOT NULL DEFAULT 'pending',
  ai_summary TEXT,
  ai_tag TEXT,
  source TEXT NOT NULL DEFAULT 'live',
  status TEXT NOT NULL DEFAULT 'active',
  block_height INTEGER,
  block_hash TEXT,
  block_time TEXT,
  meta TEXT
);

CREATE TABLE IF NOT EXISTS batches (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS batch_txs (
  batch_id TEXT NOT NULL REFERENCES batches (id),
  txid TEXT NOT NULL,
  block_height INTEGER,
  block_hash TEXT,
  block_time TEXT,
  value_sats INTEGER NOT NULL,
  link_reason TEXT NOT NULL,
  UNIQUE (batch_id, txid)
);

CREATE TABLE IF NOT EXISTS labels (
  id TEXT PRIMARY KEY,
  address TEXT NOT NULL,
  tag TEXT NOT NULL,
  note TEXT,
  evidence_url TEXT,
  author_did TEXT REFERENCES identities (did),
  source TEXT NOT NULL DEFAULT 'crowd',
  -- what the `address` column identifies: a bitcoin address, or a txid
  target_kind TEXT NOT NULL DEFAULT 'address',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS labels_address_tag_source
  ON labels (address, tag, source);

CREATE INDEX IF NOT EXISTS labels_address ON labels (address);

CREATE TABLE IF NOT EXISTS votes (
  label_id TEXT NOT NULL REFERENCES labels (id),
  voter_did TEXT NOT NULL,
  value INTEGER NOT NULL CHECK (value IN (-1, 1)),
  created_at TEXT,
  UNIQUE (label_id, voter_did)
);

CREATE TABLE IF NOT EXISTS did_documents (
  did TEXT PRIMARY KEY,
  document TEXT NOT NULL,
  cached_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_feedback (
  event_id TEXT NOT NULL REFERENCES events (id),
  voter_did TEXT NOT NULL,
  value TEXT NOT NULL CHECK (value IN ('confirm', 'refute')),
  UNIQUE (event_id, voter_did)
);
