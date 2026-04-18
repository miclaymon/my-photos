<script setup lang="ts">
/**
 * The drag ghost: a fixed-position element that follows the cursor while
 * tiles are being dragged. Shows thumbnails of all dragged items stacked
 * slightly offset. Animates back to the origin tile on release.
 *
 * Single item: no rotation, clean thumbnail.
 * Multiple items: fanned card-deck effect — each backing card rotates and
 * translates slightly differently so the stack looks like a held hand of cards.
 */
const { isDragging, isReturning, dragItems, ghostX, ghostY, ghostW, ghostH } = useTileDrag()

// Show at most 5 thumbnails in the fan; "+N" badge if more
const MAX_STACK = 5

// Per-index transform for multi-item fan. Index 0 = front card (no rotation).
// Backing cards fan out alternately left/right with increasing angle.
const FAN_TRANSFORMS = [
  '',                                         // 0: front — no transform
  'translate(6px, -4px)   rotate(4deg)  scale(0.97)',
  'translate(-7px, -5px)  rotate(-5deg) scale(0.95)',
  'translate(11px, -7px)  rotate(7deg)  scale(0.93)',
  'translate(-12px, -8px) rotate(-8deg) scale(0.91)',
]

const stackItems = computed(() => dragItems.value.slice(0, MAX_STACK))
const extraCount = computed(() => Math.max(0, dragItems.value.length - MAX_STACK))
const isMulti    = computed(() => dragItems.value.length > 1)

const ghostStyle = computed(() => ({
  left:   ghostX.value + 'px',
  top:    ghostY.value + 'px',
  width:  ghostW.value + 'px',
  height: ghostH.value + 'px',
}))

function thumbTransform(index: number): string | undefined {
  if (!isMulti.value) return undefined
  return FAN_TRANSFORMS[index] ?? FAN_TRANSFORMS[FAN_TRANSFORMS.length - 1]
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="isDragging"
      class="drag-ghost"
      :class="{ 'is-returning': isReturning, 'is-multi': isMulti }"
      :style="ghostStyle"
      aria-hidden="true"
    >
      <!--
        Render backing cards first (highest index = furthest back in the fan),
        so front card (index 0) sits on top in stacking order.
        z-index: stackItems.length - originalIndex ensures index 0 = highest.
      -->
      <div
        v-for="d in [...stackItems].reverse()"
        :key="d.item.id"
        class="drag-ghost-thumb"
        :style="{
          zIndex:    stackItems.length - stackItems.indexOf(d),
          transform: thumbTransform(stackItems.indexOf(d)),
        }"
      >
        <img
          :src="d.src"
          :alt="d.item.originalFilename"
          draggable="false"
        />
      </div>

      <!-- Count badge when more than MAX_STACK items -->
      <div v-if="extraCount > 0" class="drag-ghost-count">
        +{{ extraCount }}
      </div>

      <!-- Single-item filename label -->
      <div v-if="dragItems.length === 1" class="drag-ghost-label">
        {{ dragItems[0]?.item.originalFilename }}
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.drag-ghost {
  position: fixed;
  pointer-events: none;
  z-index: 9000;
  border-radius: 4px;
  overflow: visible;
  /* Slight scale-up on pickup for tactile feel */
  transform: scale(1.05);
  opacity: 0.92;
  filter: drop-shadow(0 8px 24px rgba(0,0,0,0.4));
  will-change: left, top;
  /* Extra room around the ghost so fanned backing cards aren't clipped */
  isolation: isolate;
}

/* Returning to origin: smooth ease back + fade out */
.drag-ghost.is-returning {
  transition:
    left     0.26s cubic-bezier(0.2, 0, 0, 1),
    top      0.26s cubic-bezier(0.2, 0, 0, 1),
    opacity  0.26s ease,
    transform 0.26s ease;
  opacity:   0;
  transform: scale(1);
}

/* Each stacked thumbnail */
.drag-ghost-thumb {
  position: absolute;
  inset: 0;
  border-radius: 4px;
  overflow: hidden;
  border: 1.5px solid rgba(255, 255, 255, 0.35);
  box-shadow: 0 2px 8px rgba(0,0,0,0.25);
  background: var(--color-skeleton-base, #222);
}

.drag-ghost-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  user-select: none;
  -webkit-user-drag: none;
}

/* "+N more" badge */
.drag-ghost-count {
  position: absolute;
  top: -10px;
  right: -10px;
  z-index: 10;
  min-width: 22px;
  height: 22px;
  border-radius: 999px;
  background: var(--color-accent, #3b82f6);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 5px;
  box-shadow: 0 2px 6px rgba(0,0,0,0.3);
}

/* Filename label (single-item only) */
.drag-ghost-label {
  position: absolute;
  bottom: -26px;
  left: 0;
  right: 0;
  text-align: center;
  font-size: 11px;
  color: var(--color-text-primary, #fff);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  background: color-mix(in srgb, var(--color-bg, #000) 72%, transparent);
  backdrop-filter: blur(8px);
  border-radius: 4px;
  padding: 3px 6px;
}
</style>
