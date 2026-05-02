<script setup lang="ts">
// VideoJS requires browser APIs — parent must render this client-side only
// (either via v-if after mount, or wrapped in <ClientOnly>).

const props = defineProps<{
  src:          string
  contentType?: string
  aspectRatio:  number   // width / height (e.g. 1.777 for 16:9, 0.5625 for 9:16)
}>()

const videoRef = ref<HTMLVideoElement | null>(null)

// Minimal interface — avoids importing heavyweight VideoJS types at compile time
interface VjsPlayer {
  src:        (sources: { src: string; type: string }[]) => void
  play:       () => Promise<void> | undefined
  isDisposed: () => boolean
  dispose:    () => void
  on:         (event: string, handler: () => void) => void
  error:      () => { code: number } | null
}

let player: VjsPlayer | null = null
let _retryCount = 0
const MAX_RETRIES = 2

function resolvedType(): string {
  if (props.contentType) return props.contentType
  const path = (props.src.split('?')[0] ?? '').toLowerCase()
  if (path.endsWith('.mp4'))  return 'video/mp4'
  if (path.endsWith('.webm')) return 'video/webm'
  if (path.endsWith('.mov'))  return 'video/quicktime'
  if (path.endsWith('.mkv'))  return 'video/x-matroska'
  return 'video/mp4'
}

onMounted(async () => {
  const { default: videojs } = await import('video.js')
  if (!videoRef.value) return
  player = videojs(videoRef.value, {
    controls:    true,
    autoplay:    true,
    loop:        true,
    playsinline: true,
    fill:        true,
    preload:     'metadata',
    sources:     [{ src: props.src, type: resolvedType() }],
  }) as unknown as VjsPlayer

  // Retry on MEDIA_ERR_NETWORK (code 2) — e.g. MinIO ERR_CONTENT_LENGTH_MISMATCH
  player.on('error', () => {
    if (!player || player.isDisposed()) return
    const err = player.error()
    if (err?.code === 2 && _retryCount < MAX_RETRIES) {
      _retryCount++
      setTimeout(() => {
        if (!player || player.isDisposed()) return
        player.src([{ src: props.src, type: resolvedType() }])
        player.play()?.catch(() => {})
      }, 800)
    }
  })
})

// Update source when navigating between videos without remounting
watch(() => props.src, (src) => {
  if (!player || player.isDisposed()) return
  _retryCount = 0
  player.src([{ src, type: resolvedType() }])
  player.play()?.catch(() => {})
})

onBeforeUnmount(() => {
  if (player && !player.isDisposed()) {
    player.dispose()
    player = null
  }
})
</script>

<template>
  <div
    class="vp-outer"
    :style="{ '--vp-ar': aspectRatio }"
    @click.stop
  >
    <video ref="videoRef" class="video-js vjs-big-play-centered" />
  </div>
</template>

<style scoped>
.vp-outer {
  /* Normal-flow flex item inside .preview-image-area (flex, align/justify: center).
     Both axes are constrained: width/height fill the container, aspect-ratio keeps
     the correct shape, and the flex centering ensures letterboxing happens outside
     the player rather than inside. */
  width: 100%;
  height: 100%;
  aspect-ratio: var(--vp-ar);
  flex-shrink: 0;
  position: relative;   /* VideoJS fills this; not absolute so it stays in flow */
  border-radius: 3px;
  overflow: hidden;
  background: #000;
}

/* Fill the container; cap z-indices so nothing escapes the preview-main stacking context */
:deep(.video-js) {
  width: 100%;
  height: 100%;
  border-radius: 3px;
  font-family: inherit;
}

:deep(.vjs-modal-dialog),
:deep(.vjs-menu),
:deep(.vjs-menu-content) {
  z-index: 10;
}

/* Control bar */
:deep(.vjs-control-bar) {
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

/* Big play button — centered circle */
:deep(.vjs-big-play-button) {
  border: 2px solid rgba(255, 255, 255, 0.85);
  background: rgba(0, 0, 0, 0.5);
  border-radius: 50%;
  width: 60px;
  height: 60px;
  line-height: 58px;
  top: 50%;
  left: 50%;
  margin: 0;
  transform: translate(-50%, -50%);
  transition: background 0.15s, border-color 0.15s;
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}

:deep(.vjs-big-play-button:hover),
:deep(.vjs-big-play-button:focus) {
  background: rgba(0, 0, 0, 0.72);
  border-color: #fff;
}

:deep(.vjs-big-play-button .vjs-icon-placeholder::before) {
  font-size: 28px;
  line-height: 58px;
}

/* Accent color for the playhead and load bar */
:deep(.vjs-play-progress) {
  background: var(--color-accent, #6366f1);
}
:deep(.vjs-play-progress::before) {
  color: var(--color-accent, #6366f1);
}
:deep(.vjs-load-progress) {
  background: rgba(255, 255, 255, 0.18);
}
:deep(.vjs-load-progress div) {
  background: rgba(255, 255, 255, 0.1);
}

/* Volume slider */
:deep(.vjs-volume-level) {
  background: var(--color-accent, #6366f1);
}
:deep(.vjs-volume-level::before) {
  color: var(--color-accent, #6366f1);
}
</style>
