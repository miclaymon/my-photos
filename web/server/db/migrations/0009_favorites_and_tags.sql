-- ── User favorites ────────────────────────────────────────────────────────────
-- Per-user, per-media favorite state. No library dimension — a media item is
-- favorited by a user regardless of which library it is being viewed from.
-- When displaying favorites in a library context, the query joins libraryMedia
-- to filter to only items that belong to the selected library.

CREATE TABLE user_favorites (
  user_id  INTEGER NOT NULL REFERENCES users(id),
  media_id TEXT    NOT NULL REFERENCES media(id),
  added_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, media_id)
);

CREATE INDEX idx_user_favorites_user  ON user_favorites(user_id);
CREATE INDEX idx_user_favorites_media ON user_favorites(media_id);

-- ── User-created tags ─────────────────────────────────────────────────────────
-- Library-scoped, visible to all library members. Distinct from internal ML tags.

CREATE TABLE user_tags (
  id         TEXT    NOT NULL PRIMARY KEY,
  library_id TEXT    NOT NULL REFERENCES libraries(id),
  name       TEXT    NOT NULL,
  color      TEXT,               -- optional hex colour, e.g. '#6366f1'
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_user_tags_library ON user_tags(library_id);

-- ── Media ↔ Tag membership ────────────────────────────────────────────────────

CREATE TABLE media_tags (
  tag_id   TEXT    NOT NULL REFERENCES user_tags(id) ON DELETE CASCADE,
  media_id TEXT    NOT NULL REFERENCES media(id)     ON DELETE CASCADE,
  added_by INTEGER NOT NULL REFERENCES users(id),
  added_at INTEGER NOT NULL,
  PRIMARY KEY (tag_id, media_id)
);

CREATE INDEX idx_media_tags_tag   ON media_tags(tag_id);
CREATE INDEX idx_media_tags_media ON media_tags(media_id);
