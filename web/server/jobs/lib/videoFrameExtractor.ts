/**
 * videoFrameExtractor — extracts JPEG frames from a video buffer using ffmpeg.
 *
 * Strategy:
 *   - Short videos  (≤ 20 s)  → 1 frame every 2 s
 *   - Medium videos (≤ 300 s) → 1 frame every 5 s
 *   - Long videos   (> 300 s) → 1 frame every 10 s
 *   - Hard cap: 60 frames maximum (prevents runaway on hour-long videos)
 *
 * Frames are scaled to 1280 px wide (sufficient for COCO-SSD and face-api;
 * avoids decoding huge 4K video frames into memory).
 *
 * Uses a per-call temp directory that is always cleaned up in a finally block.
 */
import { execFile }              from 'node:child_process'
import { promisify }             from 'node:util'
import { tmpdir }                from 'node:os'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join }                  from 'node:path'
import { randomUUID }            from 'node:crypto'

const execFileAsync = promisify(execFile)

export interface VideoFrame {
  buffer:       Buffer   // JPEG image data
  timestampSec: number   // approximate position in the video (seconds)
  index:        number   // 0-based frame index
}

/**
 * Extracts frames from a raw video buffer.
 *
 * @param videoBuffer   - raw bytes of the video file
 * @param durationSecs  - known video duration in seconds (used to pick interval)
 * @returns array of VideoFrame objects; empty if ffmpeg fails or produces none
 */
export async function extractVideoFrames(
  videoBuffer:  Buffer,
  durationSecs: number | null,
): Promise<VideoFrame[]> {
  const dur      = durationSecs ?? 60
  const interval = dur <= 20 ? 2 : dur <= 300 ? 5 : 10
  const maxFrames = Math.min(60, Math.ceil(dur / interval) + 1)

  const workDir   = join(tmpdir(), `myphotos-frames-${randomUUID()}`)
  const inputPath = join(workDir, 'input.bin')

  try {
    await mkdir(workDir, { recursive: true })
    await writeFile(inputPath, videoBuffer)

    // -vf fps=1/N   → one frame every N seconds
    // scale=1280:-2 → resize to 1280 px wide, height rounded to even
    // -frames:v N   → hard cap on output count
    // -q:v 3        → JPEG quality (2=best, 31=worst; 3 is excellent)
    await execFileAsync('ffmpeg', [
      '-i',       inputPath,
      '-vf',      `fps=1/${interval},scale=1280:-2`,
      '-frames:v', String(maxFrames),
      '-q:v',     '3',
      '-y',       // overwrite without prompting
      join(workDir, 'frame%04d.jpg'),
    ], { timeout: 120_000 })  // 2-minute timeout for very large videos

    const files = (await readdir(workDir))
      .filter(f => f.match(/^frame\d+\.jpg$/))
      .sort()

    const frames: VideoFrame[] = []
    for (let i = 0; i < files.length; i++) {
      const buf = await readFile(join(workDir, files[i]!))
      frames.push({ buffer: buf, timestampSec: i * interval, index: i })
    }
    return frames
  } catch (err) {
    // Non-fatal — the calling job will log and mark the item as processed
    console.error('[videoFrameExtractor] ffmpeg failed:', err)
    return []
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {})
  }
}
