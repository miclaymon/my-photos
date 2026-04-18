export type JobName = 'object-detection' | 'face-grouping' | 'ocr' | 'location-geocode'

export interface JobStatus {
  running:     boolean
  startedAt:   Date | null
  finishedAt:  Date | null
  total:       number
  processed:   number
  errors:      number
  lastError:   string | null
  currentItem: string | null  // filename being processed right now
}

export interface JobOptions {
  /** Limit processing to a single library; omit to process all libraries. */
  libraryId?:  string
  /** If true, reprocess items already processed by this job. Default: false. */
  reprocess?:  boolean
}

export type StatusUpdater = (update: Partial<JobStatus>) => void
