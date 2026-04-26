<script setup lang="ts">
const props = defineProps<{
  segments: Array<{ bytes: number; color: string; label?: string }>
  total:    number
}>()

// Filter to segments with actual content and compute widths
const bars = computed(() => {
  const active = props.segments.filter(s => s.bytes > 0 && props.total > 0)
  return active.map(s => ({
    ...s,
    pct: (s.bytes / props.total) * 100,
  }))
})
</script>

<template>
  <div class="storage-meter" role="img" aria-label="Storage usage breakdown">
    <div
      v-for="(bar, i) in bars"
      :key="i"
      class="storage-meter-seg"
      :class="{
        'is-first': i === 0,
        'is-last':  i === bars.length - 1,
      }"
      :style="{ width: `${bar.pct}%`, background: bar.color }"
      :title="bar.label ? `${bar.label}: ${bar.pct.toFixed(1)}%` : `${bar.pct.toFixed(1)}%`"
    />
  </div>
</template>

<style scoped>
.storage-meter {
  display: flex;
  height: 10px;
  border-radius: 5px;
  overflow: hidden;
  gap: 1px;
  background: var(--color-border);
}

.storage-meter-seg {
  height: 100%;
  min-width: 2px;
  transition: opacity 0.15s;
}

.storage-meter-seg.is-first {
  border-radius: 5px 0 0 5px;
}

.storage-meter-seg.is-last {
  border-radius: 0 5px 5px 0;
}

/* Single segment gets full rounding */
.storage-meter-seg.is-first.is-last {
  border-radius: 5px;
}

.storage-meter-seg:hover {
  opacity: 0.85;
}
</style>
