import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core'

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .$defaultFn(() => new Date())
    .notNull(),
})

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert

// ── Media ─────────────────────────────────────────────────────────────────────

export const media = sqliteTable('media', {
  id:               text('id').primaryKey(),   // UUID
  uploadedBy:       integer('uploaded_by').notNull().references(() => users.id),
  objectKey:        text('object_key').notNull().unique(),  // path in RustFS bucket
  originalFilename: text('original_filename').notNull(),
  contentType:      text('content_type').notNull(),
  size:             integer('size').notNull(),  // bytes
  width:            integer('width'),           // px — populated after processing
  height:           integer('height'),
  aspectRatio:      real('aspect_ratio'),
  durationSeconds:  real('duration_seconds'),   // for video
  takenAt:          integer('taken_at', { mode: 'timestamp' }),  // from EXIF
  createdAt:        integer('created_at', { mode: 'timestamp' })
    .$defaultFn(() => new Date())
    .notNull(),
  // Media processing
  thumbnailObjectKey:  text('thumbnail_object_key'),   // extracted video frame
  previewObjectKey:    text('preview_object_key'),     // short low-res clip for hover
  exifData:            text('exif_data'),              // JSON-encoded EXIF tags
  hash:               text('hash'),                   // SHA-256 of file content (dedup)
  // Lifecycle
  archivedAt:         integer('archived_at', { mode: 'timestamp' }),
  deletionDate:       integer('deletion_date', { mode: 'timestamp' }),
  // Background processing timestamps (null = not yet processed)
  objectsProcessedAt:   integer('objects_processed_at',   { mode: 'timestamp' }),
  facesProcessedAt:     integer('faces_processed_at',     { mode: 'timestamp' }),
  ocrProcessedAt:       integer('ocr_processed_at',       { mode: 'timestamp' }),
  // Reverse-geocoded location label derived from GPS coordinates in EXIF/video metadata
  locationLabel:        text('location_label'),
  locationProcessedAt:  integer('location_processed_at', { mode: 'timestamp' }),
})

export type Media    = typeof media.$inferSelect
export type NewMedia = typeof media.$inferInsert

// ── Deleted items (soft-delete / trash) ──────────────────────────────────────

export const deletedItems = sqliteTable('deleted_items', {
  id:           integer('id').primaryKey({ autoIncrement: true }),
  mediaId:      text('media_id').notNull().references(() => media.id),
  deletedBy:    integer('deleted_by').notNull().references(() => users.id),
  deletionDate: integer('deletion_date', { mode: 'timestamp' }).notNull(), // expiry; permanent delete after this
  reason:       text('reason'),
  createdAt:    integer('created_at', { mode: 'timestamp' })
    .$defaultFn(() => new Date())
    .notNull(),
})

export type DeletedItem    = typeof deletedItems.$inferSelect
export type NewDeletedItem = typeof deletedItems.$inferInsert

// ── Library ───────────────────────────────────────────────────────────────────

export const libraries = sqliteTable('libraries', {
  id:        text('id').primaryKey(),   // UUID
  name:      text('name').notNull(),
  type:      text('type', { enum: ['personal', 'shared'] }).notNull(),
  ownerId:   integer('owner_id').references(() => users.id),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .$defaultFn(() => new Date())
    .notNull(),
})

export type Library    = typeof libraries.$inferSelect
export type NewLibrary = typeof libraries.$inferInsert

// ── Library ↔ Media membership ────────────────────────────────────────────────

export const libraryMedia = sqliteTable('library_media', {
  libraryId: text('library_id').notNull().references(() => libraries.id),
  mediaId:   text('media_id').notNull().references(() => media.id),
  addedAt:   integer('added_at', { mode: 'timestamp' })
    .$defaultFn(() => new Date())
    .notNull(),
})

// ── Library access (shared libraries) ────────────────────────────────────────

export const libraryAccess = sqliteTable('library_access', {
  id:        integer('id').primaryKey({ autoIncrement: true }),
  libraryId: text('library_id').notNull().references(() => libraries.id),
  userId:    integer('user_id').notNull().references(() => users.id),
  /** 'owner' = full control; 'editor' = upload/edit; 'viewer' = read-only */
  role:      text('role', { enum: ['owner', 'editor', 'viewer'] }).notNull(),
  addedAt:   integer('added_at', { mode: 'timestamp' })
    .$defaultFn(() => new Date())
    .notNull(),
})

export type LibraryAccess    = typeof libraryAccess.$inferSelect
export type NewLibraryAccess = typeof libraryAccess.$inferInsert

// ── Share links ───────────────────────────────────────────────────────────────

export const shareLinks = sqliteTable('share_links', {
  id:         text('id').primaryKey(),               // UUID used as the public token
  libraryId:  text('library_id').notNull().references(() => libraries.id),
  /** Null = whole library; set for album-level links (future albums feature) */
  albumId:    text('album_id'),
  /** JSON array of media UUIDs; null = whole library/album is shared */
  mediaIds:   text('media_ids'),
  createdBy:  integer('created_by').notNull().references(() => users.id),
  expiresAt:  integer('expires_at',   { mode: 'timestamp' }),
  lastUsedAt: integer('last_used_at', { mode: 'timestamp' }),
  revokedAt:  integer('revoked_at',   { mode: 'timestamp' }),
  createdAt:  integer('created_at',   { mode: 'timestamp' })
    .$defaultFn(() => new Date())
    .notNull(),
})

export type ShareLink    = typeof shareLinks.$inferSelect
export type NewShareLink = typeof shareLinks.$inferInsert

// ── Albums ────────────────────────────────────────────────────────────────────

export const albums = sqliteTable('albums', {
  id:        text('id').primaryKey(),             // UUID
  libraryId: text('library_id').notNull().references(() => libraries.id),
  ownerId:   integer('owner_id').notNull().references(() => users.id),
  name:      text('name').notNull(),
  /** Explicitly chosen cover item; null = auto (first item or 2×2 collage) */
  coverId:   text('cover_id'),                    // soft ref — no FK to allow cover to be removed
  createdAt: integer('created_at', { mode: 'timestamp' })
    .$defaultFn(() => new Date())
    .notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .$defaultFn(() => new Date())
    .notNull(),
  deletedAt: integer('deleted_at', { mode: 'timestamp' }),
})

export type Album    = typeof albums.$inferSelect
export type NewAlbum = typeof albums.$inferInsert

// ── Album ↔ Media items (ordered, with optional caption) ─────────────────────

export const albumItems = sqliteTable('album_items', {
  id:        integer('id').primaryKey({ autoIncrement: true }),
  albumId:   text('album_id').notNull().references(() => albums.id),
  mediaId:   text('media_id').notNull().references(() => media.id),
  /** Ascending integer; editors can reorder. Lower = earlier in album. */
  sortOrder: integer('sort_order').notNull().default(0),
  /** Album-specific caption; stored here, not on the media record. */
  caption:   text('caption'),
  addedAt:   integer('added_at', { mode: 'timestamp' })
    .$defaultFn(() => new Date())
    .notNull(),
})

export type AlbumItem    = typeof albumItems.$inferSelect
export type NewAlbumItem = typeof albumItems.$inferInsert

// ── Album access (per-album sharing grants) ───────────────────────────────────

export const albumAccess = sqliteTable('album_access', {
  id:         integer('id').primaryKey({ autoIncrement: true }),
  albumId:    text('album_id').notNull().references(() => albums.id),
  userId:     integer('user_id').notNull().references(() => users.id),
  /** 'edit' = add/remove/reorder items; 'view' = read-only access */
  permission: text('permission', { enum: ['view', 'edit'] }).notNull(),
  grantedAt:  integer('granted_at', { mode: 'timestamp' })
    .$defaultFn(() => new Date())
    .notNull(),
})

export type AlbumAccess    = typeof albumAccess.$inferSelect
export type NewAlbumAccess = typeof albumAccess.$inferInsert

// ── Subjects (people & pets identified across a library) ──────────────────────

export const subjects = sqliteTable('subjects', {
  id:                        text('id').primaryKey(),  // UUID
  libraryId:                 text('library_id').notNull().references(() => libraries.id),
  /** 'person' = human face; 'pet' = cat/dog/etc. */
  type:                      text('type', { enum: ['person', 'pet'] }).notNull(),
  name:                      text('name'),             // user-assigned; null until named
  hidden:                    integer('hidden').notNull().default(0),  // 1 = hidden from People & Pets UI
  /** For pet subjects: JSON string[] of COCO class names (e.g. '["cat","dog"]'). Decoupled from display name. */
  petClass:                  text('pet_class'),
  /** User-selected cover photo (overrides representative_detection_id heuristic). */
  coverMediaId:              text('cover_media_id'),
  representativeDetectionId: integer('representative_detection_id'), // soft ref to subject_detections.id
  createdAt:                 integer('created_at', { mode: 'timestamp' })
    .$defaultFn(() => new Date())
    .notNull(),
  updatedAt:                 integer('updated_at', { mode: 'timestamp' })
    .$defaultFn(() => new Date())
    .notNull(),
})

export type Subject    = typeof subjects.$inferSelect
export type NewSubject = typeof subjects.$inferInsert

// ── Subject detections (individual face/pet detections per photo) ─────────────

export const subjectDetections = sqliteTable('subject_detections', {
  id:          integer('id').primaryKey({ autoIncrement: true }),
  mediaId:     text('media_id').notNull().references(() => media.id),
  subjectId:   text('subject_id').references(() => subjects.id),  // null until clustered
  /** JSON: {x, y, w, h} as fractions 0–1 of image dimensions */
  boundingBox: text('bounding_box').notNull(),
  /** Euclidean distance to nearest centroid at assignment time; null for pre-migration rows */
  matchDistance: real('match_distance'),
  /** 1 if this match was borderline and needs user confirmation */
  reviewNeeded:  integer('review_needed').notNull().default(0),
  /** JSON float32 array: 128-d face embedding from face-api; null for pets */
  descriptor:  text('descriptor'),
  confidence:  real('confidence').notNull(),
  detectedAt:  integer('detected_at', { mode: 'timestamp' })
    .$defaultFn(() => new Date())
    .notNull(),
})

export type SubjectDetection    = typeof subjectDetections.$inferSelect
export type NewSubjectDetection = typeof subjectDetections.$inferInsert

// ── Media objects (COCO-SSD detected object categories per photo) ─────────────

export const mediaObjects = sqliteTable('media_objects', {
  id:          integer('id').primaryKey({ autoIncrement: true }),
  mediaId:     text('media_id').notNull().references(() => media.id),
  /** COCO class label, e.g. 'cat', 'person', 'car' */
  class:       text('class').notNull(),
  confidence:  real('confidence').notNull(),
  /** JSON: {x, y, w, h} in image pixels */
  boundingBox: text('bounding_box').notNull(),
  detectedAt:  integer('detected_at', { mode: 'timestamp' })
    .$defaultFn(() => new Date())
    .notNull(),
})

export type MediaObject    = typeof mediaObjects.$inferSelect
export type NewMediaObject = typeof mediaObjects.$inferInsert

// ── Media OCR (extracted text per photo) ──────────────────────────────────────

export const mediaOcr = sqliteTable('media_ocr', {
  id:          integer('id').primaryKey({ autoIncrement: true }),
  mediaId:     text('media_id').notNull().unique().references(() => media.id),
  text:        text('text').notNull(),
  confidence:  real('confidence'),
  processedAt: integer('processed_at', { mode: 'timestamp' })
    .$defaultFn(() => new Date())
    .notNull(),
})

export type MediaOcr    = typeof mediaOcr.$inferSelect
export type NewMediaOcr = typeof mediaOcr.$inferInsert

// ── User favorites ────────────────────────────────────────────────────────────
// Per-user, per-media. Scoped to library context at query time via libraryMedia join.
// A favorite is the same regardless of which library the item is viewed from.

export const userFavorites = sqliteTable('user_favorites', {
  userId:  integer('user_id').notNull().references(() => users.id),
  mediaId: text('media_id').notNull().references(() => media.id),
  addedAt: integer('added_at', { mode: 'timestamp' })
    .$defaultFn(() => new Date())
    .notNull(),
})

export type UserFavorite    = typeof userFavorites.$inferSelect
export type NewUserFavorite = typeof userFavorites.$inferInsert

// ── User-created tags ─────────────────────────────────────────────────────────
// Library-scoped, visible to all library members. Created and managed by users.
// Distinct from internal_tags (ML/system) which are stored on the media record.

export const userTags = sqliteTable('user_tags', {
  id:        text('id').primaryKey(),  // UUID
  libraryId: text('library_id').notNull().references(() => libraries.id),
  name:      text('name').notNull(),
  /** Optional hex colour for the tag badge, e.g. '#6366f1' */
  color:     text('color'),
  createdBy: integer('created_by').notNull().references(() => users.id),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .$defaultFn(() => new Date())
    .notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .$defaultFn(() => new Date())
    .notNull(),
})

export type UserTag    = typeof userTags.$inferSelect
export type NewUserTag = typeof userTags.$inferInsert

// ── Media ↔ Tag membership ────────────────────────────────────────────────────

export const mediaTags = sqliteTable('media_tags', {
  tagId:   text('tag_id').notNull().references(() => userTags.id),
  mediaId: text('media_id').notNull().references(() => media.id),
  addedBy: integer('added_by').notNull().references(() => users.id),
  addedAt: integer('added_at', { mode: 'timestamp' })
    .$defaultFn(() => new Date())
    .notNull(),
})
