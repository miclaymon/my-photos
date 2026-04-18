# my-photos

A self-hosted photo library — a personal alternative to Google Photos and iCloud Photos.

Built with [Nuxt 3](https://nuxt.com), [Vue 3](https://vuejs.org), and [TypeScript](https://www.typescriptlang.org). Photo storage is backed by [RustFS](https://rustfs.com) (S3-compatible object storage). The web UI and RustFS are intended to be bundled into a single Docker container for easy self-hosted deployment.

> **Status:** Active development. Core gallery, upload pipeline, trash, archive, albums, people & pets (face/object detection + grouping), tags, places (reverse geocoding), and settings are live. OCR is functional. Invite flow, mobile apps, and Docker bundling are pending.

---

## Tech stack

| Layer | Technology |
|---|---|
| Framework | [Nuxt 3](https://nuxt.com) + [Vue 3](https://vuejs.org) + TypeScript |
| Build tool | [Vite](https://vite.dev) (via Nuxt) |
| Images | [`@nuxt/image`](https://image.nuxt.com) — lazy-loading, progressive load, responsive srcset |
| Styling | Custom CSS + [Tailwind CSS](https://tailwindcss.com) utilities |
| Auth | [`nuxt-auth-utils`](https://github.com/atinux/nuxt-auth-utils) — signed cookie sessions, scrypt passwords |
| ORM | [Drizzle ORM](https://orm.drizzle.team) |
| Database | SQLite via [`better-sqlite3`](https://github.com/WiseLibs/better-sqlite3) |
| Storage | [RustFS](https://rustfs.com) / S3-compatible via [`@aws-sdk/client-s3`](https://www.npmjs.com/package/@aws-sdk/client-s3) |

---

## Requirements

- **Node.js** v20 or later
- **npm** v10 or later
- **openssl** (for auto-generating the session secret — available on most systems)
- A running **RustFS** instance accessible on the local network (see Storage below)

---

## Getting started

### 1. Clone and set up

```bash
git clone <repo-url>
cd my-photos-nuxt
./setup.sh
```

`setup.sh` will:
- Check Node.js and npm versions
- Create a `.env` file from `.env.example` with an auto-generated session secret
- Run `npm install`
- Generate and apply the initial database migration
- Prompt you to create your first user account

### 2. Configure storage

Edit `.env` and fill in the `STORAGE_*` variables to point at your RustFS instance. See `.env.example` for descriptions of each variable.

The bucket is created automatically on first connection if it does not already exist.

### 3. Start the dev server

```bash
./start-dev.sh
```

Then open [http://localhost:3000](http://localhost:3000). You will be redirected to `/login` — sign in with the credentials you created during setup.

---

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `NUXT_SESSION_PASSWORD` | Yes | — | Secret used to sign session cookies. Must be ≥ 32 characters. Generate with `openssl rand -base64 48`. |
| `DATABASE_PATH` | No | `./data/photos.db` | Path to the SQLite database file. |
| `STORAGE_ENDPOINT` | Yes | — | Full URL of the RustFS / S3 endpoint, including port (e.g. `http://192.168.1.250:6969`). |
| `STORAGE_ACCESS_KEY_ID` | Yes | — | S3 access key ID. |
| `STORAGE_SECRET_ACCESS_KEY` | Yes | — | S3 secret access key. |
| `STORAGE_BUCKET_NAME` | No | `photos` | Name of the bucket to store photos in. Created automatically if missing. |
| `STORAGE_REGION` | No | `us-east-1` | S3 region. Any value works for self-hosted — SDKs require a non-empty string. |
| `STORAGE_MAX_VERSIONS` | No | `3` | Max versions to retain per photo object. Set to `0` to disable versioning. |

Copy `.env.example` to `.env` and fill in your values, or let `setup.sh` generate the auth secret for you.

---

## API

All server-side API routes are versioned under `/api/v1/`.

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/auth/login` | Authenticate with email and password |
| `POST` | `/api/v1/auth/logout` | Invalidate the current session |
| `GET`  | `/api/v1/storage/health` | Test storage connectivity and return byte breakdown by media type |
| `GET`  | `/api/v1/storage/stats` | Per-user storage usage breakdown (libraries, years, types) |
| `GET`  | `/api/v1/library` | List all libraries the current user has access to |
| `POST` | `/api/v1/library` | Create a new library |
| `GET`  | `/api/v1/library/:id/media` | Paginated media listing for a library (grouped by date) |
| `POST` | `/api/v1/library/:id/albums` | Create a new album within a library |
| `POST` | `/api/v1/library/:id/copy-from` | Copy media items from another library into this library |
| `GET`  | `/api/v1/library/:id/subjects` | List all subjects (people & pets) in a library |
| `GET`  | `/api/v1/library/:id/subjects/:subjectId/media` | Gallery items for a single subject |
| `GET`  | `/api/v1/library/:id/tags` | List all user tags in a library (with item counts) |
| `POST` | `/api/v1/library/:id/tags` | Create a new tag |
| `PATCH` | `/api/v1/library/:id/tags/:tagId` | Rename or recolour a tag |
| `DELETE` | `/api/v1/library/:id/tags/:tagId` | Delete a tag (cascades to all media associations) |
| `POST` | `/api/v1/library/:id/tags/:tagId/items` | Apply a tag to one or more media items |
| `DELETE` | `/api/v1/library/:id/tags/:tagId/items/:mediaId` | Remove a tag from a media item |
| `GET`  | `/api/v1/library/:id/favorites` | Current user's favorited items in the library |
| `GET`  | `/api/v1/library/:id/places` | Distinct reverse-geocoded location labels with counts |
| `GET`  | `/api/v1/library/:id/places/items` | Media items for a specific location label |
| `GET`  | `/api/v1/media/upload-url` | Generate a presigned S3 PUT URL for direct upload |
| `POST` | `/api/v1/media/complete` | Record metadata after a direct upload completes |
| `GET`  | `/api/v1/media/:id` | Full metadata + presigned URLs for a single media item |
| `GET`  | `/api/v1/media/:id/subjects` | Detected subjects (people & pets) with bounding boxes |
| `GET`  | `/api/v1/media/:id/objects` | COCO-SSD detected objects with normalised bounding boxes |
| `GET`  | `/api/v1/media/:id/tags` | Tags applied to a specific media item |
| `PUT`  | `/api/v1/media/:id/favorite` | Add to favorites (idempotent) |
| `DELETE` | `/api/v1/media/:id/favorite` | Remove from favorites |
| `POST` | `/api/v1/media/:id/soft-delete` | Move a media item to trash |
| `POST` | `/api/v1/media/:id/archive` | Archive a media item |
| `POST` | `/api/v1/media/:id/unarchive` | Unarchive a media item |
| `POST` | `/api/v1/media/:id/restore` | Restore a trashed media item |
| `DELETE` | `/api/v1/media/:id` | Permanently delete a media item |
| `GET`  | `/api/v1/albums` | List all albums the current user can view |
| `GET`  | `/api/v1/albums/:id` | Get album detail (items, cover, metadata) |
| `PATCH` | `/api/v1/albums/:id` | Rename an album or set its cover |
| `DELETE` | `/api/v1/albums/:id` | Delete an album |
| `POST` | `/api/v1/albums/:id/items` | Add media items to an album |
| `PATCH` | `/api/v1/albums/:id/items/:mediaId` | Update a per-item caption |
| `DELETE` | `/api/v1/albums/:id/items/:mediaId` | Remove a media item from an album |
| `POST` | `/api/v1/albums/:id/reorder` | Save a new item sort order for an album |
| `GET`  | `/api/v1/subjects/:id` | Get a single subject |
| `PATCH` | `/api/v1/subjects/:id` | Update subject name, hidden status, or cover photo |
| `POST` | `/api/v1/subjects/:id/merge` | Merge one subject into another |
| `PATCH` | `/api/v1/subjects/detections/:id` | Confirm, dismiss, or set cover on a face detection |
| `GET`  | `/api/v1/archive` | List archived media (newest first) |
| `GET`  | `/api/v1/trash` | List trashed media (soonest-expiring first) |
| `GET`  | `/api/v1/admin/users` | List all users (Admin only) |
| `GET`  | `/api/v1/admin/storage` | Server-wide storage metrics (Admin only) |
| `GET`  | `/api/v1/admin/jobs/status` | Current status of all background jobs (Admin only) |
| `POST` | `/api/v1/admin/jobs/run` | Trigger a background job (Admin only) |

---

## npm scripts

| Script | Description |
|---|---|
| `npm run dev` | Start the Nuxt development server |
| `npm run build` | Build for production |
| `npm run preview` | Preview the production build locally |
| `npm run db:generate` | Generate a new SQL migration from schema changes |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:studio` | Open Drizzle Studio (visual DB browser) |
| `npm run db:seed -- <email> <password>` | Create a user account |

---

## Project structure

```
my-photos-nuxt/
├── app.vue                          # Root shell; data-theme binding
├── layouts/
│   └── default.vue                  # App shell (header, side nav, global overlays)
├── middleware/
│   └── auth.ts                      # Redirect unauthenticated users to /login
├── pages/
│   ├── index.vue                    # Redirects to active library
│   ├── login.vue                    # Login page
│   ├── albums.vue                   # Redirects to /library/:id/albums
│   ├── archive.vue                  # Archive view
│   ├── trash.vue                    # Trash view
│   ├── favorites.vue                # Favourites view (stub)
│   ├── videos.vue                   # Videos-only view (stub)
│   ├── updates.vue                  # Activity feed (stub)
│   ├── library/
│   │   └── [library]/
│   │       ├── index.vue            # Gallery page for a specific library
│   │       ├── albums.vue           # Albums list for a library
│   │       └── album/
│   │           └── [albumId].vue    # Album detail (drag-and-drop reorder, captions)
│   ├── preview/
│   │   └── [id].vue                 # Full-page media preview (View Transitions API)
│   └── admin/
│       └── index.vue                # Admin dashboard (stub)
├── components/
│   ├── App*.vue                     # App-shell components (header, nav, settings,
│   │                                #   upload, toast, modals, drag overlays)
│   ├── AlbumCard.vue                # Album cover card with context menu
│   └── PhotoGallery.vue             # Gallery with mode toggle, floating controls,
│                                    #   selection pill
├── composables/
│   ├── useAppShell.ts               # Theme, side nav, settings, active library
│   ├── useGallery.ts                # Mode, size, gap, selection state
│   ├── useGalleryData.ts            # Library media fetching (date-grouped)
│   ├── useAlbums.ts                 # Album CRUD and listing
│   ├── useLibraries.ts              # Library listing
│   ├── useUpload.ts                 # Drag-to-upload state and upload pipeline
│   ├── useToast.ts                  # Global toast notification queue
│   └── useJustifiedLayout.ts        # Masonry row layout algorithm
├── server/
│   ├── api/
│   │   └── v1/
│   │       ├── auth/                # login + logout endpoints
│   │       ├── media/               # upload-url, complete, soft-delete, archive, restore
│   │       ├── library/             # library CRUD, media listing, album creation, copy-from
│   │       ├── albums/              # album detail, items, reorder, rename, delete
│   │       ├── archive/             # archived media listing
│   │       ├── trash/               # trashed media listing
│   │       ├── storage/             # health check endpoint
│   │       └── admin/               # admin-only endpoints
│   ├── utils/
│   │   ├── storage.ts               # S3 client singleton + helpers
│   │   └── albumAuth.ts             # Album permission helpers
│   └── db/
│       ├── index.ts                 # DB connection + auto-migrate
│       ├── schema.ts                # Full schema (see Database section below)
│       └── migrations/              # Generated SQL migration files
├── assets/css/
│   └── main.css                     # All component styles + design tokens
├── scripts/
│   └── seed.ts                      # CLI: create user account
├── public/                          # Static assets
├── nuxt.config.ts
├── drizzle.config.ts
├── DESIGN.md                        # Design direction and UI specification
├── REQUIREMENTS.md                  # Functional and non-functional requirements
├── setup.sh                         # First-time setup script
├── start-dev.sh                     # Start the development server
└── .env.example                     # Environment variable template
```

---

## Storage

Files are uploaded directly from the browser to RustFS using **presigned PUT URLs** — binary data never passes through the Nuxt server. The flow:

1. Client calls `POST /api/v1/media/upload-url` → receives a time-limited presigned URL and an `objectKey`
2. Client `PUT`s the file directly to RustFS using the presigned URL (XHR for progress events)
3. Client calls `POST /api/v1/media/complete` → server records metadata (filename, size, content type, EXIF, library associations) in SQLite

Object keys follow the pattern `{userId}/{uuid}/{filename}` to keep objects organised by owner while preventing name collisions.

### Verifying the storage connection

```bash
# With the dev server running:
curl -b <session-cookie> http://localhost:3000/api/v1/storage/health
```

Expected response: `{"ok":true,"bucket":"photos","objectCount":0}`

---

## Database

The app uses **SQLite** stored at `./data/photos.db` (configurable via `DATABASE_PATH`). The database is created automatically on first run and migrations are applied on every server startup.

### Schema overview

| Table | Purpose |
|---|---|
| `users` | User accounts (id, email, passwordHash) |
| `media` | Photo/video metadata (objectKey, dimensions, EXIF, takenAt, archivedAt, locationLabel, processing timestamps) |
| `libraries` | Named collections (personal or shared) |
| `library_access` | Per-user library role assignments (owner / editor / viewer) |
| `library_media` | Many-to-many: which media belongs to which library |
| `albums` | Curated albums scoped to a library (owner, name, cover, timestamps) |
| `album_items` | Album membership: mediaId, sortOrder, per-item caption |
| `album_access` | Per-user album permission grants (view / edit) |
| `deleted_items` | Soft-delete tracking (deletedBy, deletionDate) |
| `share_links` | Public share link tokens |
| `subjects` | Detected people and pets (name, type, hidden, coverMediaId, representativeDetectionId) |
| `subject_detections` | Per-photo face detections (fractional bbox, 128-d descriptor, confidence, reviewNeeded) |
| `media_objects` | COCO-SSD detected objects per photo (class, confidence, pixel bbox) |
| `media_ocr` | OCR-extracted text per photo (text, confidence) |
| `user_favorites` | Per-user, per-media favorites |
| `user_tags` | Library-scoped user-created tags (name, optional color) |
| `media_tags` | Many-to-many: tag ↔ media associations |

### Making schema changes

1. Edit `server/db/schema.ts`
2. Run `npm run db:generate` to create a new migration file
3. Run `npm run db:migrate` to apply it, or restart the dev server (auto-migrates on startup)

### Adding a user

```bash
npm run db:seed -- you@example.com yourpassword
```

---

## Authentication

Sessions are stored in a signed, encrypted HTTP-only cookie. Passwords are hashed with **scrypt** (via [`@adonisjs/hash`](https://docs.adonisjs.com/guides/security/hashing)). There is no password reset flow yet.

The `NUXT_SESSION_PASSWORD` secret must be kept private and consistent — rotating it will invalidate all existing sessions.

---

## Uploading photos

Drag one or more files onto any authenticated page. An overlay appears; drop to stage the files. A library picker lets you choose which library to add them to. As files upload, a progress toast appears in the bottom-right corner. Duplicate detection runs before each upload begins.

Supported types: `image/*` and `video/*`.

---

## Albums

Albums are curated collections of media items within a library, with a defined sort order and optional per-item captions. They are created and managed at `/library/:id/albums`.

- Album covers animate with the View Transitions API when opening the album detail page.
- In edit mode, items can be reordered by drag-and-drop and given captions.
- Owners and library editors can modify album contents; viewers get read-only access.
- Media can be added to an album from the gallery selection pill using the "Add to album" action.

---

## Roadmap

Key upcoming items:
- Invite flow (`/invite/:token`) — invite-only registration, signed tokens, library access grants
- Virtual/bidirectional scroll anchored to a date
- Video hover preview (low-res transcoded clip)
- Full-text search (OCR text + metadata)
- E2e test layer (Playwright)
- Docker container bundling (web UI + RustFS)

Recently shipped:
- People & Pets — face detection, grouping, naming, cover photos, hide/unhide, preview overlays with click-to-name/navigate
- Object detection — COCO-SSD bounding boxes on preview (admin setting), pet subject creation
- OCR background task — text extraction stored per photo
- Tags — library-scoped user tags, tag management, preview page inline tagging with autocomplete
- Places — GPS → Nominatim reverse geocoding, `/library/:id/places` grouped view
- Settings modal — Features tab (AI feature toggles with master switch); Appearance → Preview section (admin object hitbox toggle)
