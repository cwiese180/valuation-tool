CREATE TRIGGER raw_no_update BEFORE UPDATE ON raw_records BEGIN SELECT RAISE(ABORT,'raw source records are immutable'); END;
CREATE TRIGGER raw_no_delete BEFORE DELETE ON raw_records BEGIN SELECT RAISE(ABORT,'raw source records are immutable'); END;
INSERT INTO schema_version VALUES(2,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
