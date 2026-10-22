CREATE TABLE IF NOT EXISTS captures (
 id TEXT PRIMARY KEY, raw BLOB NOT NULL, filename TEXT, actor TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'saved', route TEXT, result TEXT, error TEXT,
 job_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS captures_raw_immutable BEFORE UPDATE OF raw,filename,actor ON captures BEGIN SELECT RAISE(ABORT,'capture input is immutable'); END;
CREATE TABLE IF NOT EXISTS field_ownership (
 card_id TEXT NOT NULL REFERENCES cards(id), field TEXT NOT NULL,
 owner TEXT NOT NULL, basis_revision_id TEXT, strategy TEXT NOT NULL,
 rejected TEXT NOT NULL DEFAULT '[]', updated_at TEXT NOT NULL,
 PRIMARY KEY(card_id,field)
);
CREATE TABLE IF NOT EXISTS model_usage (
 id TEXT PRIMARY KEY, day TEXT NOT NULL, purpose TEXT NOT NULL, input_chars INTEGER NOT NULL,
 created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS usage_day ON model_usage(day);
-- Conservative migration: existing user content is never bulk regenerated.
INSERT OR IGNORE INTO field_ownership(card_id,field,owner,basis_revision_id,strategy,rejected,updated_at)
 SELECT c.id,f.field,'human',c.current_revision_id,'legacy-protected','[]',c.updated_at
 FROM cards c CROSS JOIN (SELECT 'title' field UNION SELECT 'summary' UNION SELECT 'content' UNION SELECT 'tags' UNION SELECT 'card_type' UNION SELECT 'source_label') f;
UPDATE audit_findings SET status='dismissed' WHERE finding_type IN ('incomplete','missing_tags') AND status='open';
