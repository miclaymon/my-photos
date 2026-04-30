<script setup lang="ts">
import type { GallerySection } from '~/composables/useGalleryData'
import { initGallery } from '~/composables/useGalleryData'

const props = defineProps<{
  sections: ReadonlyArray<GallerySection>
}>()

const { timelineData, loadedLibraryId } = useGalleryData()
const { activeStickyKey }               = useActiveStickySection()

const isExpanded = ref(false)
const isDragging = ref(false)
const panelRef   = ref<HTMLElement | null>(null)
const hostTop    = ref(0)
const hostH      = ref(0)

// ── Track main-content bounds for fixed overlay placement ─────────────────────
onMounted(() => {
  const el = document.getElementById('main-content')
  if (!el) return
  const sync = () => {
    const r  = el.getBoundingClientRect()
    hostTop.value = r.top
    hostH.value   = r.height
  }
  sync()
  const ro = new ResizeObserver(sync)
  ro.observe(el)
  window.addEventListener('resize', sync)
  onUnmounted(() => { ro.disconnect(); window.removeEventListener('resize', sync) })
})

// ── Tick position helpers ─────────────────────────────────────────────────────

// Map a 0–1 data fraction to a CSS top% value within the panel.
// 4 % and 96 % give breathing room so labels at the extremes aren't clipped.
function toY(frac: number): string {
  return `${(4 + frac * 92).toFixed(2)}%`
}

// ── Year ticks (one per year, at the position where that year's newest photo sits)
// ── Month dots (every subsequent month bucket within a year)
// Only months that actually have photos appear in `timelineData.buckets`, so
// empty months / years are never rendered.
const yearTicks = computed(() => {
  const d = timelineData.value
  if (!d || !d.total) return []
  let cum = 0, prevYear = -1
  const out: { year: number; frac: number }[] = []
  for (const b of d.buckets) {
    if (b.year !== prevYear) {
      out.push({ year: b.year, frac: cum / d.total })
      prevYear = b.year
    }
    cum += b.count
  }
  return out
})

const monthDots = computed(() => {
  const d = timelineData.value
  if (!d || !d.total) return []
  let cum = 0, prevYear = -1
  const out: { frac: number }[] = []
  for (const b of d.buckets) {
    const isFirst = b.year !== prevYear
    if (!isFirst) out.push({ frac: cum / d.total })
    prevYear = b.year
    cum += b.count
  }
  return out
})

// ── Thumb (current visible section) ──────────────────────────────────────────
const thumbFrac = computed((): number => {
  const key = activeStickyKey.value
  const d   = timelineData.value
  if (!key || !d || !d.total) return 0
  const [ys, ms] = key.split('-')
  const yr = parseInt(ys!), mo = parseInt(ms!)
  let cum = 0
  for (const b of d.buckets) {
    if (b.year === yr && b.month === mo) return cum / d.total
    cum += b.count
  }
  return 0
})

const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const thumbLabel = computed((): string => {
  const key = activeStickyKey.value
  if (!key) return ''
  const [ys, ms] = key.split('-')
  return `${MONTH_ABBR[parseInt(ms!) - 1]} ${ys}`
})

// ── Navigation ────────────────────────────────────────────────────────────────
let _raf: number | null = null

function jumpTo(clientY: number) {
  if (_raf) cancelAnimationFrame(_raf)
  _raf = requestAnimationFrame(() => {
    _raf = null
    const d = timelineData.value
    if (!d || !d.total || !panelRef.value) return

    // Convert clientY → panel fraction (0=top, 1=bottom) → data fraction
    const r       = panelRef.value.getBoundingClientRect()
    const rawFrac = Math.max(0, Math.min(1, (clientY - r.top) / r.height))
    const dataFrac = Math.max(0, Math.min(1, (rawFrac * 100 - 4) / 92))
    const target   = dataFrac * d.total

    // Find the bucket at this cumulative position
    let cum  = 0
    let best = d.buckets[0]!
    for (const b of d.buckets) {
      if (cum + b.count >= target) { best = b; break }
      cum += b.count
    }

    const pad     = (n: number) => String(n).padStart(2, '0')
    const monthKey = `${best.year}-${pad(best.month)}`

    // If the month is in the currently loaded window, scroll to it directly.
    // Otherwise re-initialize the gallery centered on the last day of that month.
    const loaded = props.sections.find(s => s.monthKey === monthKey)
    if (loaded) {
      document
        .querySelector<HTMLElement>(`[data-gallery-section="${loaded.dateKey}"]`)
        ?.scrollIntoView({ behavior: 'instant', block: 'start' })
    } else if (loadedLibraryId.value) {
      // last day of target month → initGallery adds +1 day → loads whole month and older
      const lastDay = new Date(best.year, best.month, 0).getDate()
      initGallery(loadedLibraryId.value, `${best.year}-${pad(best.month)}-${pad(lastDay)}`)
    }
  })
}

// ── Mouse drag ────────────────────────────────────────────────────────────────
function onMousedown(e: MouseEvent) {
  e.preventDefault()
  isDragging.value = true
  jumpTo(e.clientY)
  const move = (ev: MouseEvent) => jumpTo(ev.clientY)
  const up   = () => {
    isDragging.value = false
    document.removeEventListener('mousemove', move)
    document.removeEventListener('mouseup', up)
  }
  document.addEventListener('mousemove', move)
  document.addEventListener('mouseup', up)
}

// ── Touch drag ────────────────────────────────────────────────────────────────
let _hideTimer: ReturnType<typeof setTimeout> | null = null
function onTouchstart(e: TouchEvent) {
  e.preventDefault()
  isExpanded.value = true
  clearTimeout(_hideTimer!)
  const go  = (ev: TouchEvent) => { const t = ev.touches[0]; if (t) jumpTo(t.clientY) }
  const end = () => {
    document.removeEventListener('touchmove', go)
    document.removeEventListener('touchend', end)
    _hideTimer = setTimeout(() => { if (!isDragging.value) isExpanded.value = false }, 1200)
  }
  document.addEventListener('touchmove', go, { passive: false })
  document.addEventListener('touchend', end)
  const t = e.touches[0]; if (t) jumpTo(t.clientY)
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="timelineData && timelineData.total > 0"
      class="gsb"
      :class="{ 'gsb--on': isExpanded || isDragging }"
      :style="{ top: hostTop + 'px', height: hostH + 'px' }"
      @mouseenter="isExpanded = true"
      @mouseleave="isDragging || (isExpanded = false)"
    >
      <div
        ref="panelRef"
        class="gsb-panel"
        @mousedown="onMousedown"
        @touchstart.prevent="onTouchstart"
      >
        <!-- Year ticks — major marks, show the year number -->
        <div
          v-for="y in yearTicks"
          :key="y.year"
          class="gsb-tick gsb-tick--year"
          :style="{ top: toY(y.frac) }"
        >
          <span class="gsb-tick-lbl">{{ y.year }}</span>
          <span class="gsb-tick-mark" />
        </div>

        <!-- Month dots — minor marks, no label (only months with photos) -->
        <span
          v-for="(m, i) in monthDots"
          :key="i"
          class="gsb-dot"
          :style="{ top: toY(m.frac) }"
        />

        <!-- Thumb — current visible section -->
        <div
          v-if="activeStickyKey"
          class="gsb-thumb"
          :style="{ top: toY(thumbFrac) }"
        >
          <span class="gsb-thumb-lbl">{{ thumbLabel }}</span>
          <span class="gsb-thumb-pip" />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* ── Outer hit zone — transparent, extends left for easy hover approach ─────── */
.gsb {
  position: fixed;
  right: 0;
  z-index: 400;
  width: 88px;
  pointer-events: auto;
  user-select: none;
}

/* ── Panel — slides in from the right on hover / drag ───────────────────────── */
.gsb-panel {
  position: absolute;
  top: 8px;
  bottom: 8px;
  right: 0;
  width: 76px;
  background: rgba(14, 14, 14, 0.86);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border-radius: 8px 0 0 8px;
  cursor: pointer;
  opacity: 0;
  transform: translateX(80px);
  transition: opacity 0.15s ease, transform 0.15s ease;
}
.gsb--on .gsb-panel {
  opacity: 1;
  transform: translateX(0);
}

/* ── Shared tick layout: zero-height flex row centred on `top` value ─────────── */
.gsb-tick,
.gsb-thumb {
  position: absolute;
  left: 0;
  right: 0;
  height: 0;
  display: flex;
  align-items: center;
  overflow: visible;
  pointer-events: none;
}
.gsb-thumb { z-index: 2; }

/* ── Year tick ───────────────────────────────────────────────────────────────── */
.gsb-tick-lbl {
  flex: 1;
  padding-right: 6px;
  text-align: right;
  font-size: 9.5px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: rgba(255, 255, 255, 0.62);
  white-space: nowrap;
  line-height: 1;
}
.gsb-tick-mark {
  display: block;
  flex-shrink: 0;
  width: 10px;
  height: 1.5px;
  background: rgba(255, 255, 255, 0.48);
  margin-right: 4px;
}

/* ── Month dot ───────────────────────────────────────────────────────────────── */
.gsb-dot {
  position: absolute;
  right: 6px;
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.28);
  transform: translateY(-50%);
  pointer-events: none;
}

/* ── Thumb ───────────────────────────────────────────────────────────────────── */
.gsb-thumb-lbl {
  flex: 1;
  padding-right: 6px;
  text-align: right;
  font-size: 9.5px;
  font-weight: 700;
  color: #fff;
  white-space: nowrap;
  line-height: 1;
}
.gsb-thumb-pip {
  display: block;
  flex-shrink: 0;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #fff;
  margin-right: 0;
  box-shadow: 0 0 0 2.5px rgba(255, 255, 255, 0.22);
}
</style>
