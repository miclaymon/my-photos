# my-photos

A self-hosted photo library — a personal alternative to Google Photos and iCloud Photos.

Uses a **three-tier architecture**: a [FastAPI](https://fastapi.tiangolo.com) data API server (Python + PostgreSQL + background ML workers), a [Nuxt 3](https://nuxt.com) web client (Vue 3 + TypeScript, acts as BFF for the browser), and [RustFS](https://rustfs.com) for encrypted S3-compatible object storage.

> **Status:** Active development — in the process of migrating from a Nuxt monolith to the three-tier architecture. Core gallery, upload pipeline, trash, archive, albums, people & pets (face/object detection + grouping), tags, places (reverse geocoding), and settings are live in the web client. FastAPI data API scaffolded; route migration in progress. Invite flow, mobile apps, and Docker bundling are pending.

---

## Architecture

```
Clients (browser / iOS / Android)
        │
        ▼
  web/  Nuxt / Nitro  ──BFF proxy──▶  api/  FastAPI + PostgreSQL
        │                                           │
        └──────────────────────────────────────────┘
                    (pre-signed URLs)
                           │
                           ▼
                      RustFS (S3)
```

- The **browser** only talks to Nitro (port 3000). Nitro proxies `/api/v1/*` to FastAPI.
- **Mobile clients** (future) call FastAPI directly.
- **File uploads/downloads** bypass both servers via pre-signed S3 URLs.

---

## Tech stack

### Web client (`web/`)

| Layer | Technology |
|---|---|
| Framework | [Nuxt 3](https://nuxt.com) + [Vue 3](https://vuejs.org) + TypeScript |
| Role | SSR, BFF proxy, web session cookie management |
| Auth | [`nuxt-auth-utils`](https://github.com/atinux/nuxt-auth-utils) — cookie session wrapping FastAPI JWT |
| Styling | Custom CSS + [Tailwind CSS](https://tailwindcss.com) utilities |
| Images | [`@nuxt/image`](https://image.nuxt.com) — lazy-loading, WebP, responsive srcset |

### Data API (`api/`)

| Layer | Technology |
|---|---|
| Framework | [FastAPI](https://fastapi.tiangolo.com) (Python 3.11+) |
| Auth | JWT — [`python-jose`](https://github.com/mpdavis/python-jose) + bcrypt via [`passlib`](https://passlib.readthedocs.io) |
| ORM | [SQLAlchemy](https://www.sqlalchemy.org) 2.0 |
| Database | [PostgreSQL](https://www.postgresql.org) |
| Migrations | [Alembic](https://alembic.sqlalchemy.org) |
| Storage client | [boto3](https://boto3.amazonaws.com) (S3-compatible) |
| Background workers | Python — easyocr/pytesseract (OCR), onnxruntime/ultralytics YOLOv8 (object detection), insightface ArcFace (face detection + grouping), Nominatim/reverse_geocoder (geocoding), zxing-cpp/pyzbar (barcode/QR detection) |

---

## Requirements

- **Python** 3.11 or later (for `api/`)
- **PostgreSQL** 14 or later (running locally or on the network)
- **Node.js** v20 or later (for `web/`)
- **npm** v10 or later
- **openssl** (for auto-generating secrets)
- A running **RustFS** instance accessible on the local network (see Storage below)

---

## Getting started

### 1. Set up the Data API

```bash
cd api
./setup.sh
```

`api/setup.sh` will:
- Check Python 3.11+
- Create and activate a `.venv` virtual environment
- Install Python dependencies from `requirements.txt`
- Run an interactive setup wizard (`scripts/setup_db.py`) that:
  - Prompts for PostgreSQL superuser credentials
  - Creates the app database and a least-privilege app user
  - Writes `api/.env` with generated secrets
  - Applies Alembic migrations (creates all tables)
  - Prompts to create the first admin account

### 2. Set up the web client

```bash
cd web
./setup.sh
```

`web/setup.sh` will:
- Check Node.js and npm versions
- Create `web/.env` from `web/.env.example` with an auto-generated session secret
- Run `npm install`

Edit `web/.env` and set `DATA_API_URL` to point at the FastAPI server (default: `http://localhost:8000`).

### 3. Configure storage

Edit `api/.env` and fill in the `STORAGE_*` variables to point at your RustFS instance.

### 4. Start both servers

In one terminal:
```bash
cd api && ./start-dev.sh    # FastAPI on http://localhost:8000
```

In another terminal:
```bash
cd web && ./start-dev.sh    # Nuxt on http://localhost:3000
```

Open [http://localhost:3000](http://localhost:3000) and sign in with the admin credentials you created during setup.

---

## Environment variables

### `api/.env`

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | Yes | — | PostgreSQL connection string, e.g. `postgresql://user:pass@localhost:5432/myphotos` |
| `SECRET_KEY` | Yes | — | JWT signing secret. Generate with `openssl rand -base64 48`. |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | No | `60` | JWT access token lifetime. |
| `REFRESH_TOKEN_EXPIRE_DAYS` | No | `30` | JWT refresh token lifetime. |
| `STORAGE_ENDPOINT` | Yes | — | Full URL of the RustFS / S3 endpoint, e.g. `http://192.168.1.250:6969`. |
| `STORAGE_ACCESS_KEY_ID` | Yes | — | S3 access key ID. |
| `STORAGE_SECRET_ACCESS_KEY` | Yes | — | S3 secret access key. |
| `STORAGE_BUCKET_NAME` | No | `photos` | Bucket name. |
| `STORAGE_REGION` | No | `us-east-1` | S3 region (any value works for self-hosted). |
| `STORAGE_MAX_VERSIONS` | No | `3` | Max versions per object. `0` disables versioning. |
| `CORS_ORIGINS_RAW` | No | `http://localhost:3000` | Comma-separated allowed origins. |

### `web/.env`

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATA_API_URL` | Yes | — | URL of the FastAPI data server, e.g. `http://localhost:8000`. |
| `NUXT_SESSION_PASSWORD` | Yes | — | Session cookie signing secret. Must be ≥ 32 characters. |

---

## API

All API routes are versioned under `/api/v1/` and are implemented in the FastAPI server (`api/`). The Nuxt/Nitro server proxies these routes from the browser transparently.

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
| `GET`  | `/api/v1/media/:id/objects` | YOLOv8 detected objects with normalised bounding boxes |
| `GET`  | `/api/v1/media/:id/barcodes` | Detected barcodes/QR codes with format, data, and fractional bounding boxes |
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
| `POST` | `/api/v1/admin/subjects/recluster` | Re-cluster all person subjects by L2 distance on ArcFace embeddings (Admin only) |

---

## Scripts

### Web client (`web/`)

| Command | Description |
|---|---|
| `npm run dev` | Start the Nuxt development server |
| `npm run build` | Build for production |
| `npm run preview` | Preview the production build locally |

### Data API (`api/`)

| Command | Description |
|---|---|
| `uvicorn main:app --reload` | Start the FastAPI development server |
| `alembic upgrade head` | Apply all pending migrations |
| `alembic revision -m "describe_change"` | Create a new migration file |
| `python scripts/setup_db.py` | Re-run the interactive first-time setup |

---

## Project structure

```
my-photos/                           # Monorepo root
├── web/                             # Nuxt 3 web client (BFF + SSR)
│   ├── app.vue                      # Root shell; data-theme binding
│   ├── layouts/default.vue          # App shell (header, side nav, global overlays)
│   ├── middleware/auth.ts           # Redirect unauthenticated users to /login
│   ├── pages/                       # All page components (library, preview, albums, etc.)
│   ├── components/                  # App shell + gallery components
│   ├── composables/                 # useGallery, useUpload, useAppShell, etc.
│   ├── server/
│   │   ├── api/v1/                  # Nitro route handlers (transitional — migrating to FastAPI)
│   │   ├── jobs/                    # Background job runners (transitional — migrating to Python)
│   │   ├── utils/                   # S3 client, auth helpers
│   │   └── db/                      # Drizzle schema + migrations (transitional)
│   ├── assets/css/main.css          # All component styles + design tokens
│   ├── nuxt.config.ts
│   ├── setup.sh                     # First-time web client setup
│   ├── start-dev.sh                 # Start the Nuxt dev server
│   └── .env.example
│
├── api/                             # FastAPI data API server
│   ├── main.py                      # FastAPI app entry point; router registration
│   ├── requirements.txt
│   ├── alembic.ini
│   ├── alembic/versions/            # Database migration files (descriptive names)
│   ├── app/
│   │   ├── config.py                # Pydantic settings (reads from .env)
│   │   ├── database.py              # SQLAlchemy engine + get_db dependency
│   │   ├── dependencies.py          # get_current_user, get_admin_user
│   │   ├── models/                  # SQLAlchemy ORM models (one file per domain)
│   │   ├── schemas/                 # Pydantic request/response schemas
│   │   ├── auth/                    # JWT (jwt.py) and password hashing (password.py)
│   │   ├── storage/s3.py            # boto3 S3 client + presigned URL helpers
│   │   ├── routes/                  # FastAPI route handlers (auth, library, media, etc.)
│   │   └── workers/                 # Background job implementations + runner.py dispatcher
│   ├── scripts/setup_db.py          # Interactive first-run setup script
│   ├── setup.sh                     # First-time API server setup
│   ├── start-dev.sh                 # Start the FastAPI dev server (uvicorn)
│   └── .env.example
│
├── AGENTS.md                        # AI agent instructions and project context
├── DESIGN.md                        # Architecture diagram, UI/UX specification
├── REQUIREMENTS.md                  # Functional and non-functional requirements
├── README.md                        # This file
└── TODO.md                          # Outstanding tasks
```

---

## Storage

Files are uploaded directly from the browser to RustFS using **presigned PUT URLs** — binary data never passes through either the Nitro or FastAPI server. The flow:

1. Client calls `POST /api/v1/media/upload-url` → FastAPI generates a time-limited presigned URL and `objectKey`
2. Client `PUT`s the file directly to RustFS using the presigned URL (XHR for progress events)
3. Client calls `POST /api/v1/media/complete` → FastAPI records metadata in PostgreSQL

Object keys follow the pattern `{userId}/{uuid}/{filename}`.

### Verifying the storage connection

```bash
# With both servers running:
curl http://localhost:8000/api/v1/storage/health
```

---

## Database

The app uses **PostgreSQL**. Schema is managed by Alembic migrations in `api/alembic/versions/`.

### Schema overview

| Table | Purpose |
|---|---|
| `users` | User accounts (id, email, password_hash, display_name, is_admin) |
| `media` | Photo/video metadata (object_key, dimensions, EXIF as JSONB, taken_at, location_label, processing timestamps) |
| `libraries` | Named collections (personal or shared) |
| `library_access` | Per-user library role assignments (owner / editor / viewer) |
| `library_media` | Many-to-many: which media belongs to which library |
| `albums` | Curated albums scoped to a library |
| `album_items` | Album membership: media_id, sort_order, per-item caption |
| `album_access` | Per-user album permission grants (view / edit) |
| `deleted_items` | Soft-delete tracking (deleted_by, deletion_date) |
| `share_links` | Public share link tokens |
| `subjects` | Detected people and pets (name, type, hidden, cover_media_id) |
| `subject_detections` | Per-photo face detections (fractional bbox as JSONB, 512-d ArcFace descriptor as JSONB, confidence) |
| `media_objects` | COCO-SSD detected objects (class, confidence, pixel bbox as JSONB) |
| `media_ocr` | OCR-extracted text per photo |
| `user_favorites` | Per-user, per-media favorites |
| `user_tags` | Library-scoped user-created tags (name, optional color) |
| `media_tags` | Many-to-many: tag ↔ media associations |
| `background_jobs` | Job queue for async workers (type, status, error, timestamps) |

### Making schema changes

1. Edit the relevant model in `api/app/models/`
2. Run `alembic revision -m "describe_the_change"` to generate a migration
3. Run `alembic upgrade head` to apply it (also runs automatically on `start-dev.sh`)

---

## Authentication

Auth is owned by the FastAPI server. Passwords are hashed with **bcrypt** (passlib). Login returns a JWT access token + refresh token.

The Nuxt/Nitro web client wraps the JWT in a signed HTTP-only session cookie (`NUXT_SESSION_PASSWORD`). Rotating either secret will invalidate existing sessions.

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

### In progress
- **Architecture migration** — porting Nitro API routes to FastAPI; wiring Nitro as BFF proxy to FastAPI

### Up next
- Invite flow (`/invite/:token`) — invite-only registration, signed tokens, library access grants
- Virtual/bidirectional scroll anchored to a date
- Video hover preview (low-res transcoded clip)
- Full-text search (OCR text + metadata)
- E2e test layer (Playwright)
- Docker container bundling

### Recently shipped
- Three-tier monorepo restructure — `web/` (Nuxt BFF) + `api/` (FastAPI + PostgreSQL + Python workers)
- People & Pets — face detection (insightface ArcFace 512-d), grouping, naming, cover photos, hide/unhide, preview overlays with click-to-name/navigate; subject re-clustering admin tool; gallery shows photo thumbnails, subject detail header shows face crop
- Object detection — YOLOv8n bounding boxes on preview (admin setting), pet subject creation
- Barcode/QR detection — barcodes detected and shown in a dedicated info panel section (separate from EXIF); amber hover boxes on preview image; URL barcodes show favicon and trigger an external-link warning modal with "don't show again" option
- OCR background task — text extraction stored per photo
- Tags — library-scoped user tags, tag management, preview page inline tagging with autocomplete
- Places — GPS → Nominatim reverse geocoding, `/library/:id/places` grouped view
- Settings modal — Features tab (AI feature toggles with master switch); Appearance → Preview section (admin object hitbox toggle)
