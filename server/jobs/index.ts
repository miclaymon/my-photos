/**
 * Job registry and runner.
 *
 * Jobs are fire-and-forget from API routes. Status is tracked in-memory per
 * job name — only one instance of each job runs at a time.
 */
import type { JobName, JobOptions, JobStatus } from './types'

export type { JobName, JobOptions, JobStatus }

// ── In-memory status store ────────────────────────────────────────────────────

const _statuses = new Map<JobName, JobStatus>()

const JOB_NAMES: JobName[] = ['object-detection', 'face-grouping', 'ocr', 'location-geocode']

function defaultStatus(): JobStatus {
  return {
    running:     false,
    startedAt:   null,
    finishedAt:  null,
    total:       0,
    processed:   0,
    errors:      0,
    lastError:   null,
    currentItem: null,
  }
}

export function getJobStatus(name: JobName): JobStatus {
  return _statuses.get(name) ?? defaultStatus()
}

export function getAllJobStatuses(): Record<JobName, JobStatus> {
  const out = {} as Record<JobName, JobStatus>
  for (const name of JOB_NAMES) out[name] = getJobStatus(name)
  return out
}

// ── Runner ────────────────────────────────────────────────────────────────────

/**
 * Start a job in the background. Returns immediately.
 * No-ops if the same job is already running.
 */
export function startJob(name: JobName, opts: JobOptions = {}): { alreadyRunning: boolean } {
  const current = getJobStatus(name)
  if (current.running) return { alreadyRunning: true }

  const status: JobStatus = {
    running:     true,
    startedAt:   new Date(),
    finishedAt:  null,
    total:       0,
    processed:   0,
    errors:      0,
    lastError:   null,
    currentItem: null,
  }
  _statuses.set(name, status)

  const update = (patch: Partial<JobStatus>) => {
    Object.assign(status, patch)
    _statuses.set(name, status)
  }

  // Fire-and-forget — intentionally not awaited
  _runJob(name, opts, update)
    .catch(err => update({ lastError: String(err) }))
    .finally(() => update({ running: false, finishedAt: new Date(), currentItem: null }))

  return { alreadyRunning: false }
}

/**
 * Run a job synchronously (for use in CLI scripts where we want to await completion).
 */
export async function runJobSync(name: JobName, opts: JobOptions = {}): Promise<JobStatus> {
  const status: JobStatus = {
    running:     true,
    startedAt:   new Date(),
    finishedAt:  null,
    total:       0,
    processed:   0,
    errors:      0,
    lastError:   null,
    currentItem: null,
  }
  _statuses.set(name, status)

  const update = (patch: Partial<JobStatus>) => {
    Object.assign(status, patch)
    _statuses.set(name, status)
  }

  try {
    await _runJob(name, opts, update)
  } catch (err) {
    update({ lastError: String(err) })
  } finally {
    update({ running: false, finishedAt: new Date(), currentItem: null })
  }

  return status
}

async function _runJob(name: JobName, opts: JobOptions, update: (p: Partial<JobStatus>) => void) {
  switch (name) {
    case 'object-detection': {
      const { runObjectDetectionJob } = await import('./objectDetection')
      return runObjectDetectionJob(opts, update)
    }
    case 'face-grouping': {
      const { runFaceGroupingJob } = await import('./faceGrouping')
      return runFaceGroupingJob(opts, update)
    }
    case 'ocr': {
      const { runOcrJob } = await import('./ocr')
      return runOcrJob(opts, update)
    }
    case 'location-geocode': {
      const { runLocationGeocodeJob } = await import('./locationReverseGeocode')
      return runLocationGeocodeJob(opts, update)
    }
  }
}
