<script setup lang="ts">
interface StorageStats {
  totalBytes: number
  totalCount: number
  isAdmin:    boolean
  byType: Array<{
    type:  'image' | 'video'
    label: string
    bytes: number
    count: number
  }>
  byYear: Array<{
    year:  string
    bytes: number
    count: number
  }>
  byLibrary: Array<{
    id:    string
    name:  string
    type:  'personal' | 'shared' | 'other_personal'
    bytes: number
    count: number
  }>
}

const stats   = ref<StorageStats | null>(null)
const loading = ref(false)
const error   = ref<string | null>(null)

async function load() {
  if (loading.value) return
  loading.value = true
  error.value   = null
  try {
    stats.value = await $fetch<StorageStats>('/api/v1/storage/stats')
  } catch {
    error.value = 'Could not load storage data.'
  } finally {
    loading.value = false
  }
}

onMounted(load)

// ── Formatting ───────────────────────────────────────────────────────────────

function fmtBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(0)} KB`
  return `${bytes} B`
}

function fmtCount(n: number): string {
  return n.toLocaleString()
}

// ── Colour palette ───────────────────────────────────────────────────────────

const TYPE_COLOR: Record<string, string> = {
  image: '#3b82f6',   // blue-500
  video: '#f97316',   // orange-500
}

// Ordered palette for year segments — distinct, visible on both light/dark
const YEAR_PALETTE = [
  '#3b82f6', // blue
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#84cc16', // lime
  '#f97316', // orange
  '#6366f1', // indigo
]

function yearColor(i: number) { return YEAR_PALETTE[i % YEAR_PALETTE.length]! }

// ── Derived: meter segments ───────────────────────────────────────────────────

const typeSegments = computed(() =>
  (stats.value?.byType ?? [])
    .filter(t => t.bytes > 0)
    .map(t => ({ ...t, color: TYPE_COLOR[t.type] ?? '#94a3b8' })),
)

const yearSegments = computed(() =>
  (stats.value?.byYear ?? [])
    .filter(y => y.bytes > 0)
    .map((y, i) => ({ ...y, color: yearColor(i) })),
)

// ── Library icon ─────────────────────────────────────────────────────────────

function libIcon(type: string) {
  if (type === 'personal')      return '👤'
  if (type === 'shared')        return '👥'
  if (type === 'other_personal') return '👥'
  return '📁'
}
</script>

<template>
  <section class="storage-tab">

    <!-- Loading -->
    <div v-if="loading" class="storage-loading">
      Loading storage data…
    </div>

    <!-- Error -->
    <div v-else-if="error" class="storage-error">
      {{ error }}
      <button class="storage-retry" @click="load">Retry</button>
    </div>

    <template v-else-if="stats">

      <!-- ── Overview ──────────────────────────────────────────────────────── -->
      <div class="storage-overview">
        <div class="storage-total-row">
          <span class="storage-total-size">{{ fmtBytes(stats.totalBytes) }} used</span>
          <span class="storage-total-count">{{ fmtCount(stats.totalCount) }} items</span>
        </div>

        <!-- Type meter bar -->
        <StorageMeter :segments="typeSegments" :total="stats.totalBytes" />

        <!-- Type legend -->
        <div class="storage-legend">
          <div v-for="seg in typeSegments" :key="seg.type" class="storage-legend-row">
            <span class="storage-legend-swatch" :style="{ background: seg.color }" />
            <span class="storage-legend-label">{{ seg.label }}</span>
            <span class="storage-legend-bytes">{{ fmtBytes(seg.bytes) }}</span>
            <span class="storage-legend-count">{{ fmtCount(seg.count) }} items</span>
          </div>
        </div>
      </div>

      <!-- ── By Year ───────────────────────────────────────────────────────── -->
      <div v-if="yearSegments.length" class="storage-section">
        <h4 class="storage-section-title">By year</h4>
        <StorageMeter :segments="yearSegments" :total="stats.totalBytes" />
        <div class="storage-legend">
          <div v-for="seg in yearSegments" :key="seg.year" class="storage-legend-row">
            <span class="storage-legend-swatch" :style="{ background: seg.color }" />
            <span class="storage-legend-label">{{ seg.year }}</span>
            <span class="storage-legend-bytes">{{ fmtBytes(seg.bytes) }}</span>
            <span class="storage-legend-count">{{ fmtCount(seg.count) }} items</span>
          </div>
        </div>
      </div>

      <!-- ── By Library ────────────────────────────────────────────────────── -->
      <div v-if="stats.byLibrary.length" class="storage-section">
        <h4 class="storage-section-title">By library</h4>
        <p class="storage-section-note">
          Items in multiple libraries are counted once per library.
        </p>
        <div class="storage-library-list">
          <div
            v-for="lib in stats.byLibrary"
            :key="lib.id"
            class="storage-library-row"
          >
            <span class="storage-library-icon">{{ libIcon(lib.type) }}</span>
            <span class="storage-library-name">{{ lib.name }}</span>
            <span class="storage-library-bytes">{{ fmtBytes(lib.bytes) }}</span>
            <span class="storage-library-count">{{ fmtCount(lib.count) }}</span>
          </div>
        </div>
      </div>

      <!-- Empty -->
      <div v-if="!stats.totalCount" class="storage-empty">
        No media stored yet.
      </div>

    </template>

  </section>
</template>

<style scoped>
.storage-tab {
  display: flex;
  flex-direction: column;
  gap: 24px;
  padding: 4px 0;
}

/* ── Loading / error ─────────────────────────────────────────────────────── */
.storage-loading {
  font-size: 13px;
  color: var(--color-text-muted);
  text-align: center;
  padding: 32px 0;
}

.storage-error {
  font-size: 13px;
  color: #ef4444;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 24px 0;
}

.storage-retry {
  font-size: 12px;
  padding: 4px 12px;
  border-radius: 6px;
  border: 1px solid var(--color-border);
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
}

/* ── Overview ────────────────────────────────────────────────────────────── */
.storage-overview {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.storage-total-row {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.storage-total-size {
  font-size: 22px;
  font-weight: 700;
  color: var(--color-text-primary);
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
}

.storage-total-count {
  font-size: 13px;
  color: var(--color-text-muted);
}

/* ── Legend ──────────────────────────────────────────────────────────────── */
.storage-legend {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.storage-legend-row {
  display: grid;
  grid-template-columns: 10px 1fr auto auto;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}

.storage-legend-swatch {
  width: 10px;
  height: 10px;
  border-radius: 2px;
  flex-shrink: 0;
}

.storage-legend-label {
  color: var(--color-text-primary);
  font-weight: 500;
}

.storage-legend-bytes {
  color: var(--color-text-secondary);
  font-variant-numeric: tabular-nums;
  text-align: right;
  min-width: 56px;
}

.storage-legend-count {
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
  text-align: right;
  min-width: 60px;
}

/* ── Section ─────────────────────────────────────────────────────────────── */
.storage-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-top: 20px;
  border-top: 1px solid var(--color-border);
}

.storage-section-title {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--color-text-muted);
  margin: 0;
}

.storage-section-note {
  font-size: 11px;
  color: var(--color-text-muted);
  margin: -4px 0 0;
  line-height: 1.4;
}

/* ── Library list ────────────────────────────────────────────────────────── */
.storage-library-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.storage-library-row {
  display: grid;
  grid-template-columns: 18px 1fr auto auto;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-radius: 7px;
  font-size: 12px;
}

.storage-library-row:hover {
  background: var(--color-hover);
}

.storage-library-icon {
  font-size: 12px;
  text-align: center;
}

.storage-library-name {
  color: var(--color-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.storage-library-bytes {
  color: var(--color-text-secondary);
  font-variant-numeric: tabular-nums;
  text-align: right;
  min-width: 56px;
}

.storage-library-count {
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
  text-align: right;
  min-width: 44px;
}

/* ── Empty ───────────────────────────────────────────────────────────────── */
.storage-empty {
  font-size: 13px;
  color: var(--color-text-muted);
  text-align: center;
  padding: 24px 0;
}
</style>
