-- cover_media_id: user-selected cover photo for a subject.
-- When set, takes precedence over the representative_detection_id heuristic.
-- Applies to both person and pet subjects.
ALTER TABLE subjects ADD COLUMN cover_media_id TEXT REFERENCES media(id);
