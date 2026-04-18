<script setup lang="ts">
/**
 * Drag edge-zone overlay.
 *
 * Shown above the app content (below the drag ghost) while a custom drag is
 * in progress. Each active screen edge glows with a distinct colour gradient,
 * with a hint label indicating the action.
 *
 * Edge zones:
 *   Bottom — Download  (purple)
 *   Top    — Share     (pink)
 *   Left / Right — inactive (reserved for future Album / Favorites drop targets)
 *
 * No drop handling in this initial version — UI scaffolding only.
 * The glow opacity increases as the ghost approaches the edge (distance-based
 * CSS custom property updated on each mousemove).
 */
import { DownloadIcon, Share2Icon } from 'lucide-vue-next'

const { isDragging, ghostX, ghostY } = useTileDrag()

// Distance-based glow: starts fading in at 35% of viewport, full at 10%
const topGlow    = ref(0)
const bottomGlow = ref(0)

let rafId = 0

function updateGlows() {
  if (typeof window === 'undefined') return
  const vw = window.innerWidth
  const vh = window.innerHeight
  const x  = ghostX.value + vw  * 0   // ghost centre approx
  const y  = ghostY.value + vh  * 0.05

  // Normalise: 0 when far, 1 when at edge
  const topDist    = Math.max(0, y)                / (vh * 0.35)
  const bottomDist = Math.max(0, vh - y - 40)      / (vh * 0.35)

  topGlow.value    = Math.max(0, Math.min(1, 1 - topDist))
  bottomGlow.value = Math.max(0, Math.min(1, 1 - bottomDist))
}

watch([ghostX, ghostY], () => {
  cancelAnimationFrame(rafId)
  rafId = requestAnimationFrame(updateGlows)
})

watch(isDragging, (active) => {
  if (!active) {
    topGlow.value    = 0
    bottomGlow.value = 0
  }
})
</script>

<template>
  <Teleport to="body">
    <Transition name="dragzone">
      <div v-if="isDragging" class="drag-zone-overlay" aria-hidden="true">

        <!-- Top — Share (pink) -->
        <div
          class="drag-zone drag-zone-top"
          :style="{ '--zone-glow': topGlow }"
        >
          <div class="drag-zone-hint" :class="{ 'is-active': topGlow > 0.3 }">
            <Share2Icon :size="16" />
            <span>Share</span>
          </div>
        </div>

        <!-- Bottom — Download (purple) -->
        <div
          class="drag-zone drag-zone-bottom"
          :style="{ '--zone-glow': bottomGlow }"
        >
          <div class="drag-zone-hint" :class="{ 'is-active': bottomGlow > 0.3 }">
            <DownloadIcon :size="16" />
            <span>Download</span>
          </div>
        </div>

      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.drag-zone-overlay {
  position: fixed;
  inset: 0;
  /* Between app content and the drag ghost */
  z-index: 8500;
  pointer-events: none;
}

/* Individual edge zone */
.drag-zone {
  position: absolute;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* Top zone — Share, pink */
.drag-zone-top {
  top: 0;
  height: 35vh;
  background: radial-gradient(
    ellipse 70% 100% at 50% 0%,
    color-mix(in srgb, #ec4899 calc(var(--zone-glow, 0) * 28%), transparent) 0%,
    transparent 100%
  );
}

/* Bottom zone — Download, purple */
.drag-zone-bottom {
  bottom: 0;
  height: 35vh;
  background: radial-gradient(
    ellipse 70% 100% at 50% 100%,
    color-mix(in srgb, #a855f7 calc(var(--zone-glow, 0) * 28%), transparent) 0%,
    transparent 100%
  );
}

/* Hint label (icon + text) */
.drag-zone-hint {
  position: absolute;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.5);
  letter-spacing: 0.04em;
  transition: opacity 0.2s, transform 0.2s, color 0.2s;
  opacity: 0;
  transform: scale(0.88);
}

.drag-zone-top .drag-zone-hint {
  top: 14px;
}

.drag-zone-bottom .drag-zone-hint {
  bottom: 14px;
}

.drag-zone-hint.is-active {
  opacity: 1;
  transform: scale(1);
  color: rgba(255, 255, 255, 0.85);
}

/* Fade in/out the whole overlay */
.dragzone-enter-active,
.dragzone-leave-active {
  transition: opacity 0.15s ease;
}

.dragzone-enter-from,
.dragzone-leave-to {
  opacity: 0;
}
</style>
