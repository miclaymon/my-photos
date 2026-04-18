-- ── Background job processing tables ──────────────────────────────────────────

-- Add ML processing timestamps to existing media table
ALTER TABLE media ADD COLUMN objects_processed_at INTEGER;
ALTER TABLE media ADD COLUMN faces_processed_at    INTEGER;
ALTER TABLE media ADD COLUMN ocr_processed_at      INTEGER;

-- ── Subjects (people & pets identified across a library) ──────────────────────

CREATE TABLE subjects (
  id                          TEXT NOT NULL PRIMARY KEY,        -- UUID
  library_id                  TEXT NOT NULL REFERENCES libraries(id),
  type                        TEXT NOT NULL CHECK(type IN ('person', 'pet')),
  name                        TEXT,                             -- user-assigned name
  hidden                      INTEGER NOT NULL DEFAULT 0,       -- 0=visible, 1=hidden from UI
  representative_detection_id INTEGER,                          -- FK to subject_detections.id (set after insert)
  created_at                  INTEGER NOT NULL,
  updated_at                  INTEGER NOT NULL
);

CREATE INDEX idx_subjects_library ON subjects(library_id);
CREATE INDEX idx_subjects_type    ON subjects(type);

-- ── Subject detections (individual face/pet detections per photo) ─────────────

CREATE TABLE subject_detections (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  media_id     TEXT    NOT NULL REFERENCES media(id),
  subject_id   TEXT    REFERENCES subjects(id),                 -- null until clustering assigns it
  bounding_box TEXT    NOT NULL,   -- JSON: {"x":0.1,"y":0.2,"w":0.3,"h":0.4} as fractions 0-1
  descriptor   TEXT,               -- JSON float32 array (128-d face embedding); null for pets
  confidence   REAL    NOT NULL,
  detected_at  INTEGER NOT NULL
);

CREATE INDEX idx_subject_detections_media   ON subject_detections(media_id);
CREATE INDEX idx_subject_detections_subject ON subject_detections(subject_id);

-- ── Media objects (COCO-SSD detected object categories per photo) ─────────────

CREATE TABLE media_objects (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  media_id     TEXT    NOT NULL REFERENCES media(id),
  class        TEXT    NOT NULL,   -- COCO label, e.g. "cat", "person", "car"
  confidence   REAL    NOT NULL,
  bounding_box TEXT    NOT NULL,   -- JSON: {"x":px,"y":px,"w":px,"h":px} in image pixels
  detected_at  INTEGER NOT NULL
);

CREATE INDEX idx_media_objects_media  ON media_objects(media_id);
CREATE INDEX idx_media_objects_class  ON media_objects(class);

-- ── Media OCR (extracted text per photo) ──────────────────────────────────────

CREATE TABLE media_ocr (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  media_id     TEXT    NOT NULL UNIQUE REFERENCES media(id),
  text         TEXT    NOT NULL,
  confidence   REAL,
  processed_at INTEGER NOT NULL
);
