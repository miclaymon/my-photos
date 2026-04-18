-- Add match quality columns to subject_detections.
--
-- match_distance: Euclidean distance from this face descriptor to the subject's
--   nearest known descriptor at the time of assignment. Lower = more confident.
--   NULL for detections made before this migration.
--
-- review_needed: 1 if the match was borderline (distance between REVIEW_THRESHOLD
--   and CLUSTER_THRESHOLD). These items are surfaced in the UI for user confirmation.
ALTER TABLE subject_detections ADD COLUMN match_distance REAL;
ALTER TABLE subject_detections ADD COLUMN review_needed INTEGER NOT NULL DEFAULT 0;
