-- Add pet_class column to subjects.
-- Stores the original COCO detection class(es) as a JSON array (e.g. '["cat"]').
-- Decouples the user-facing display name from the detection class so that
-- renaming "Cat" → "Clementine" doesn't break the media_objects linkage.
ALTER TABLE subjects ADD COLUMN pet_class TEXT;

-- Back-fill: for existing pet subjects, derive pet_class from name.
-- e.g. name='Cat' → pet_class='["cat"]'
UPDATE subjects
   SET pet_class = '["' || lower(name) || '"]'
 WHERE type = 'pet' AND name IS NOT NULL AND pet_class IS NULL;
