/**
 * Server-side media processing utilities.
 *
 * processImage  — download image once; sharp extracts accurate dimensions +
 *                 raw EXIF buffer (works for JPEG, HEIC, PNG, WebP, etc.);
 *                 generates a progressive JPEG thumbnail. Returns metadata so
 *                 the caller can update the DB record.
 *
 * processVideo  — download video; ffprobe extracts dimensions + duration;
 *                 ffmpeg generates a thumbnail frame and a short hover-preview
 *                 clip. Returns metadata for a DB update.
 *
 * Both functions are safe to call fire-and-forget — they log on failure rather
 * than throwing, so the caller is never blocked.
 */

import { execFile }  from 'node:child_process'
import { tmpdir }    from 'node:os'
import { join }      from 'node:path'
import { createWriteStream, unlink } from 'node:fs'
import { pipeline }  from 'node:stream/promises'
import { promisify } from 'node:util'
import { Readable }  from 'node:stream'
import ExifReader    from 'exifreader'
import {
  GetObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3'
import { getStorageClient, getStorageBucket } from './storage'
import { logger } from './logger'

const execFileAsync = promisify(execFile)

// ── EXIF date / tag helpers ───────────────────────────────────────────────────

const EXIF_DATE_TAGS = ['DateTimeOriginal', 'DateTimeDigitized', 'DateTime'] as const
const EXIF_SAFE_KEYS = [
  'Make', 'Model', 'Software', 'DateTime', 'DateTimeOriginal', 'DateTimeDigitized',
  'ExposureTime', 'FNumber', 'ISOSpeedRatings', 'Flash', 'FocalLength',
  'GPSLatitude', 'GPSLongitude', 'GPSAltitude',
  'GPSLatitudeRef', 'GPSLongitudeRef',  // hemisphere refs needed to sign the decimal values
  'Image Width', 'Image Height', 'Orientation',
]

function parseExifBuffer(exifBuf: Buffer): { takenAt?: Date; exifData?: string } {
  try {
    // ExifReader accepts Buffer (Uint8Array subclass) directly
    const tags = ExifReader.load(exifBuf, { expanded: false })

    let takenAt: Date | undefined
    for (const tag of EXIF_DATE_TAGS) {
      const raw = (tags[tag] as { description?: string } | undefined)?.description
      if (!raw) continue
      // EXIF format: "YYYY:MM:DD HH:MM:SS" — normalise date separator
      const normalized = raw.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3')
      const d = new Date(normalized)
      if (!isNaN(d.getTime())) { takenAt = d; break }
    }

    const subset: Record<string, unknown> = {}
    for (const key of EXIF_SAFE_KEYS) {
      const t = tags[key] as { description?: unknown } | undefined
      if (t?.description !== undefined) subset[key] = t.description
    }
    const exifData = Object.keys(subset).length ? JSON.stringify(subset) : undefined

    return { takenAt, exifData }
  } catch {
    return {}
  }
}

// ── Image processing ──────────────────────────────────────────────────────────

export interface ImageProcessResult {
  thumbnailObjectKey: string
  width:              number
  height:             number
  aspectRatio:        number
  takenAt?:           Date
  exifData?:          string
}

/**
 * Download an image from storage once, then in a single pass:
 *   1. Use sharp.metadata() to get dimensions and the raw EXIF buffer
 *      (works for JPEG, HEIC/HEIF, PNG, WebP — no 64 KB truncation).
 *   2. Apply EXIF orientation to get the correct display dimensions.
 *   3. Parse the EXIF buffer with ExifReader to extract DateTimeOriginal etc.
 *   4. Generate a progressive JPEG thumbnail (max 800×800, auto-rotated).
 *   5. Upload the thumbnail and return all metadata for a DB update.
 */
export async function processImage(objectKey: string): Promise<ImageProcessResult | null> {
  try {
    const client = getStorageClient()
    const bucket = getStorageBucket()

    logger.info('image: downloading for processing', { objectKey })
    const dl = await client.send(new GetObjectCommand({ Bucket: bucket, Key: objectKey }))
    const chunks: Uint8Array[] = []
    for await (const chunk of dl.Body as Readable) chunks.push(chunk as Uint8Array)
    const inputBuffer = Buffer.concat(chunks)

    const sharp = (await import('sharp')).default

    // Read metadata — sharp parses all major formats including HEIC
    const meta = await sharp(inputBuffer).metadata()

    // Display dimensions: orientations 5–8 rotate 90°/270°, swapping w/h
    let width  = meta.width  ?? 0
    let height = meta.height ?? 0
    if (meta.orientation && meta.orientation >= 5) [width, height] = [height, width]
    const aspectRatio = height > 0 ? width / height : 1

    // Parse EXIF date and tags from the raw EXIF buffer sharp extracted
    const { takenAt, exifData } = meta.exif ? parseExifBuffer(meta.exif) : {}

    // Generate thumbnail: auto-rotate (strips orientation tag), fit inside 800×800
    const thumbBuffer = await sharp(inputBuffer)
      .rotate()
      .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82, progressive: true, mozjpeg: true })
      .toBuffer()

    const thumbKey = `${objectKey}.thumb.jpg`
    await client.send(new PutObjectCommand({
      Bucket:      bucket,
      Key:         thumbKey,
      Body:        thumbBuffer,
      ContentType: 'image/jpeg',
    }))

    logger.success('image: processing complete', { objectKey, thumbKey, width, height, hasTakenAt: !!takenAt })
    return { thumbnailObjectKey: thumbKey, width, height, aspectRatio, takenAt, exifData }
  } catch (err) {
    logger.warn('image: processing failed', { objectKey, err })
    return null
  }
}

// ── Video processing ──────────────────────────────────────────────────────────

export interface VideoProcessResult {
  thumbnailObjectKey: string
  previewObjectKey:   string
  width?:             number
  height?:            number
  aspectRatio?:       number
  durationSeconds?:   number
  takenAt?:           Date
  exifData?:          string
}

/**
 * Parse a date string from video metadata. Returns undefined for clearly
 * invalid values like Unix epoch, year-1 null placeholders, or dates before
 * the era of digital video (< 1990).
 */
function parseVideoDate(raw: string | undefined | null): Date | undefined {
  if (!raw) return undefined
  // Normalise EXIF-style "YYYY:MM:DD HH:MM:SS" separator
  const normalized = raw.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3')
  const d = new Date(normalized)
  if (isNaN(d.getTime())) return undefined
  if (d.getFullYear() < 1990) return undefined   // epoch / null placeholder
  return d
}

// Tags we want to collect for the info panel, with the preferred source group
// first. When two group-qualified tags share the same base name we keep the
// first one we see (earlier in this list = higher priority).
const VIDEO_META_TAG_ARGS = [
  // Date — group-qualified so we can control priority in extractVideoMetadata
  '-Keys:CreationDate',
  '-QuickTime:ContentCreateDate',
  '-XMP:CreateDate',
  '-EXIF:DateTimeOriginal',
  '-QuickTime:CreateDate',
  '-QuickTime:MediaCreateDate',
  // Device / capture info — let exiftool pick best source
  '-Make',
  '-Model',
  '-Software',
  // Location
  '-GPSLatitude',
  '-GPSLongitude',
  '-GPSAltitude',
  // Video technical
  '-VideoFrameRate',
  '-VideoCodec',
  '-CompressorName',
  '-AudioFormat',
  '-Rotation',
]

// Groups to skip entirely when building the display tag set
const VIDEO_META_SKIP_GROUPS = new Set(['ExifTool', 'File', 'System'])

// Base tag names that are shown in the File section already — skip from the
// metadata panel to avoid duplication
const VIDEO_META_SKIP_TAGS = new Set([
  'ImageWidth', 'ImageHeight',    // shown as Dimensions
  'Duration', 'MediaDuration',    // shown as Duration
  'FileSize', 'FileType',
  // All date tag names (shown as Taken in the File section)
  'CreationDate', 'ContentCreateDate', 'CreateDate',
  'MediaCreateDate', 'DateTimeOriginal',
])

/**
 * Extract date and display metadata from a video file using exiftool (if
 * available), falling back to ffprobe format tags for the date.
 *
 * exiftool handles QuickTime atoms, XMP, EXIF, and dozens of proprietary
 * camera tag sets that ffprobe cannot reach.
 */
async function extractVideoMetadata(filePath: string): Promise<{
  takenAt?:  Date
  exifData?: string
}> {
  // ── Try exiftool ───────────────────────────────────────────────────────────
  try {
    const { stdout } = await execFileAsync('exiftool', [
      '-j',
      '-G1',                         // group-prefixed keys: "QuickTime:Make"
      '-d', '%Y-%m-%dT%H:%M:%S%z',  // ISO 8601 with timezone
      ...VIDEO_META_TAG_ARGS,
      filePath,
    ])
    const meta = (JSON.parse(stdout) as Record<string, unknown>[])[0] ?? {}

    // ── Extract date (priority: timezone-aware tags first) ─────────────────
    let takenAt: Date | undefined
    const DATE_PRIORITY = [
      'Keys:CreationDate',
      'QuickTime:ContentCreateDate',
      'XMP:CreateDate',
      'EXIF:DateTimeOriginal',
      'QuickTime:CreateDate',
      'QuickTime:MediaCreateDate',
    ]
    for (const key of DATE_PRIORITY) {
      const d = parseVideoDate(meta[key] as string)
      if (d) { takenAt = d; break }
    }

    // ── Build display-friendly tag subset ──────────────────────────────────
    // Keys look like "QuickTime:Make"; strip the group prefix for display,
    // deduplicate by the stripped label (first occurrence wins = higher
    // priority group listed first in VIDEO_META_TAG_ARGS).
    const seenLabels = new Set<string>()
    const subset: Record<string, unknown> = {}
    const dateLabelSet = new Set(DATE_PRIORITY.map(k => k.replace(/^[^:]+:/, '')))

    for (const [rawKey, val] of Object.entries(meta)) {
      if (rawKey === 'SourceFile') continue
      const colonIdx = rawKey.indexOf(':')
      const group = colonIdx >= 0 ? rawKey.slice(0, colonIdx) : ''
      const label = colonIdx >= 0 ? rawKey.slice(colonIdx + 1) : rawKey

      if (VIDEO_META_SKIP_GROUPS.has(group)) continue
      if (VIDEO_META_SKIP_TAGS.has(label))   continue
      if (dateLabelSet.has(label))            continue  // date shown in File section
      if (seenLabels.has(label))              continue  // duplicate base name
      if (val === null || val === undefined || val === '') continue

      subset[label] = val
      seenLabels.add(label)
    }

    const exifData = Object.keys(subset).length ? JSON.stringify(subset) : undefined
    return { takenAt, exifData }
  } catch {
    // exiftool not available or failed — fall through to ffprobe for date only
  }

  // ── Fallback: ffprobe format + stream tags (date only) ─────────────────────
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      '-select_streams', 'v:0',
      filePath,
    ])
    const probe = JSON.parse(stdout) as {
      streams?: Array<{ tags?: Record<string, string> }>
      format?:  { tags?: Record<string, string> }
    }

    const allTags = [
      probe.format?.tags ?? {},
      probe.streams?.[0]?.tags ?? {},
    ]
    const dateTags = ['com.apple.quicktime.creationdate', 'creation_time', 'date']
    for (const tags of allTags) {
      for (const tag of dateTags) {
        const d = parseVideoDate(tags[tag])
        if (d) return { takenAt: d }
      }
    }
  } catch {
    // ffprobe not available — give up
  }

  return {}
}

/**
 * Download a video, extract metadata (dimensions, duration, date) via
 * exiftool + ffprobe, then:
 *   1. Extract a thumbnail frame at 1 s (ffmpeg).
 *   2. Generate a short hover-preview clip (first 6 s, 360p, 15fps, no audio).
 *   3. Upload both and return metadata for a DB update.
 */
export async function processVideo(objectKey: string): Promise<VideoProcessResult | null> {
  const tmpVideo   = join(tmpdir(), `video-${crypto.randomUUID()}.mp4`)
  const tmpThumb   = join(tmpdir(), `thumb-${crypto.randomUUID()}.jpg`)
  const tmpPreview = join(tmpdir(), `prev-${crypto.randomUUID()}.mp4`)

  const cleanup = () => {
    for (const p of [tmpVideo, tmpThumb, tmpPreview]) unlink(p, () => {})
  }

  try {
    const client = getStorageClient()
    const bucket = getStorageBucket()

    // 1. Download video
    logger.info('video: downloading for processing', { objectKey })
    const dl = await client.send(new GetObjectCommand({ Bucket: bucket, Key: objectKey }))
    await pipeline(dl.Body as Readable, createWriteStream(tmpVideo))

    // 2. Extract dimensions, duration, and creation date
    let width: number | undefined
    let height: number | undefined
    let aspectRatio: number | undefined
    let durationSeconds: number | undefined
    let takenAt: Date | undefined

    // Dimensions and duration via ffprobe (most reliable for A/V streams)
    try {
      const { stdout } = await execFileAsync('ffprobe', [
        '-v', 'quiet',
        '-print_format', 'json',
        '-show_format',
        '-show_streams',
        '-select_streams', 'v:0',
        tmpVideo,
      ])
      const probe = JSON.parse(stdout) as {
        streams?: Array<{
          width?: number
          height?: number
          duration?: string
          side_data_list?: Array<{ side_data_type?: string; rotation?: number }>
          tags?: Record<string, string>
        }>
        format?: { duration?: string }
      }

      const vs = probe.streams?.[0]
      if (vs) {
        let w = vs.width  ?? 0
        let h = vs.height ?? 0

        // Detect display rotation from side_data (Google/Apple encode rotation
        // via a Display Matrix side-data entry; values are -90, 90, 180 etc.).
        const displayMatrix = vs.side_data_list?.find(
          sd => sd.side_data_type === 'Display Matrix',
        )
        const rotation = displayMatrix?.rotation ?? Number(vs.tags?.rotate ?? 0)
        if (Math.abs(rotation) === 90 || Math.abs(rotation) === 270) {
          ;[w, h] = [h, w]
        }

        if (w && h) { width = w; height = h; aspectRatio = w / h }
        if (vs.duration) durationSeconds = parseFloat(vs.duration)
      }

      // Duration fallback: format-level value is more reliable than stream-level
      if (!durationSeconds && probe.format?.duration) {
        durationSeconds = parseFloat(probe.format.duration)
      }
    } catch (e) {
      logger.warn('video: ffprobe failed, continuing without A/V metadata', { objectKey, e })
    }

    // Date + display metadata via exiftool (QuickTime / XMP / EXIF) with ffprobe fallback
    let exifData: string | undefined
    ;({ takenAt, exifData } = await extractVideoMetadata(tmpVideo))

    logger.info('video: probe complete', { objectKey, width, height, durationSeconds, hasTakenAt: !!takenAt, hasMetadata: !!exifData })

    // 3. Extract thumbnail at 1 s (retry at 0 s for very short videos)
    logger.info('video: extracting thumbnail', { objectKey })
    await execFileAsync('ffmpeg', [
      '-ss', '1', '-i', tmpVideo,
      '-vframes', '1', '-q:v', '4', '-f', 'image2', '-y', tmpThumb,
    ]).catch(() =>
      execFileAsync('ffmpeg', ['-i', tmpVideo, '-vframes', '1', '-q:v', '4', '-f', 'image2', '-y', tmpThumb]),
    )

    // 4. Generate hover-preview clip (first 6 s, max 360p, 15fps, no audio)
    logger.info('video: creating preview clip', { objectKey })
    await execFileAsync('ffmpeg', [
      '-i', tmpVideo,
      '-t', '6',
      '-vf', 'scale=trunc(oh*a/2)*2:min(360\\,ih)',
      '-r', '15',
      '-c:v', 'libx264', '-crf', '32', '-preset', 'fast',
      '-an', '-movflags', '+faststart',
      '-y', tmpPreview,
    ])

    // 5. Upload thumbnail and preview
    const { readFile } = await import('node:fs/promises')
    const thumbKey   = `${objectKey}.thumb.jpg`
    const previewKey = `${objectKey}.preview.mp4`

    await client.send(new PutObjectCommand({
      Bucket: bucket, Key: thumbKey,
      Body: await readFile(tmpThumb), ContentType: 'image/jpeg',
    }))
    await client.send(new PutObjectCommand({
      Bucket: bucket, Key: previewKey,
      Body: await readFile(tmpPreview), ContentType: 'video/mp4',
    }))

    logger.success('video: processing complete', { objectKey, thumbKey, previewKey })
    return { thumbnailObjectKey: thumbKey, previewObjectKey: previewKey, width, height, aspectRatio, durationSeconds, takenAt, exifData }
  } catch (err) {
    logger.warn('video: processing failed', { objectKey, err })
    return null
  } finally {
    cleanup()
  }
}
