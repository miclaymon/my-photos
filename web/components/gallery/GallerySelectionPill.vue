<script setup lang="ts">
import { XIcon } from 'lucide-vue-next'

const { selectionMode, selectedCount, selectedIds, exitSelectionMode } = useGallery()
</script>

<template>
  <Teleport to="body">
    <Transition name="pill-pop">
      <div v-if="selectionMode" class="selection-pill" role="status">
        <span class="selection-pill-label">
          {{ selectedCount }} {{ selectedCount === 1 ? 'item' : 'items' }} selected
        </span>
        <slot
          name="selection-actions"
          :selected-ids="selectedIds"
          :selected-count="selectedCount"
          :exit-selection-mode="exitSelectionMode"
        />
        <button
          class="selection-pill-close"
          aria-label="Exit selection mode"
          @click="exitSelectionMode"
        >
          <XIcon :size="14" />
        </button>
      </div>
    </Transition>
  </Teleport>
</template>
