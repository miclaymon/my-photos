<script setup lang="ts">
import { TagIcon, PlusIcon, XIcon, CheckIcon } from 'lucide-vue-next'

const props = defineProps<{
  open:     boolean
  mediaIds: string[]
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  tagged: []
}>()

interface Tag {
  id:    string
  name:  string
  color: string | null
}

const { activeLibraryId } = useAppShell()

const allTags     = ref<Tag[]>([])
const loading     = ref(false)
const working     = ref(false)
const checkedIds  = ref(new Set<string>())
const newTagName  = ref('')
const newTagInput = ref<HTMLInputElement | null>(null)
const showNew     = ref(false)

async function fetchTags() {
  if (!activeLibraryId.value) return
  loading.value = true
  try {
    const data = await $fetch<{ tags: Tag[] }>(`/api/v1/library/${activeLibraryId.value}/tags`)
    allTags.value = data.tags
  } catch { /* ignore */ } finally {
    loading.value = false
  }
}

watch(() => props.open, (v) => {
  if (!v) return
  checkedIds.value = new Set()
  newTagName.value = ''
  showNew.value    = false
  fetchTags()
})

function toggleTag(id: string) {
  const s = new Set(checkedIds.value)
  s.has(id) ? s.delete(id) : s.add(id)
  checkedIds.value = s
}

async function createAndCheck() {
  const name = newTagName.value.trim()
  if (!name || working.value || !activeLibraryId.value) return
  working.value = true
  try {
    const tag = await $fetch<Tag>(`/api/v1/library/${activeLibraryId.value}/tags`, {
      method: 'POST',
      body:   { name },
    })
    allTags.value = [...allTags.value, tag]
    const s = new Set(checkedIds.value)
    s.add(tag.id)
    checkedIds.value = s
    newTagName.value = ''
    showNew.value    = false
  } catch { /* ignore */ } finally {
    working.value = false
  }
}

async function apply() {
  if (working.value || checkedIds.value.size === 0 || !activeLibraryId.value) return
  working.value = true
  try {
    await Promise.all(
      Array.from(checkedIds.value).map(tagId =>
        $fetch(`/api/v1/library/${activeLibraryId.value}/tags/${tagId}/items`, {
          method: 'POST',
          body:   { media_ids: props.mediaIds },
        }).catch(() => {}),
      ),
    )
    emit('tagged')
    emit('update:open', false)
  } finally {
    working.value = false
  }
}

function openNew() {
  showNew.value = true
  nextTick(() => newTagInput.value?.focus())
}

function close() { emit('update:open', false) }
</script>

<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div v-if="open" class="atg-backdrop" @click.self="close">
        <div class="atg-modal" role="dialog" aria-modal="true" aria-label="Add tags">

          <div class="atg-header">
            <TagIcon :size="14" class="atg-header-icon" />
            <h2 class="atg-title">Add tags</h2>
            <span class="atg-count">{{ mediaIds.length }} {{ mediaIds.length === 1 ? 'item' : 'items' }}</span>
          </div>

          <div class="atg-list">
            <div v-if="loading" class="atg-status">Loading…</div>

            <template v-else>
              <button
                v-for="tag in allTags"
                :key="tag.id"
                class="atg-row"
                :class="{ 'is-checked': checkedIds.has(tag.id) }"
                @click="toggleTag(tag.id)"
              >
                <span
                  class="atg-dot"
                  :style="tag.color ? { background: tag.color } : {}"
                />
                <span class="atg-name">{{ tag.name }}</span>
                <CheckIcon v-if="checkedIds.has(tag.id)" :size="13" class="atg-check" />
              </button>

              <div v-if="!allTags.length && !showNew" class="atg-status">
                No tags yet — create one below.
              </div>
            </template>

            <!-- New tag inline row -->
            <div v-if="showNew" class="atg-new-row">
              <input
                ref="newTagInput"
                v-model="newTagName"
                class="atg-new-input"
                placeholder="Tag name"
                :disabled="working"
                @keydown.enter.prevent="createAndCheck"
                @keydown.escape.prevent="showNew = false"
              />
              <button class="atg-new-submit" :disabled="!newTagName.trim() || working" @click="createAndCheck">
                <CheckIcon :size="13" />
              </button>
              <button class="atg-new-cancel" @click="showNew = false">
                <XIcon :size="13" />
              </button>
            </div>
          </div>

          <div class="atg-footer">
            <button class="atg-btn-new" @click="openNew">
              <PlusIcon :size="13" />
              New tag
            </button>
            <div class="atg-footer-actions">
              <button class="atg-btn-cancel" @click="close">Cancel</button>
              <button
                class="atg-btn-apply"
                :disabled="checkedIds.size === 0 || working"
                @click="apply"
              >
                {{ working ? '…' : `Apply (${checkedIds.size})` }}
              </button>
            </div>
          </div>

        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.atg-backdrop {
  position: fixed;
  inset: 0;
  z-index: 500;
  background: rgba(0,0,0,0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.atg-modal {
  background: var(--color-surface-overlay);
  border: 1px solid var(--color-border);
  border-radius: 14px;
  width: 100%;
  max-width: 300px;
  box-shadow: 0 24px 64px rgba(0,0,0,0.28);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  max-height: 72vh;
}

.atg-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 16px 10px;
  border-bottom: 1px solid var(--color-border);
}

.atg-header-icon { color: var(--color-text-muted); flex-shrink: 0; }

.atg-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-primary);
  margin: 0;
  flex: 1;
}

.atg-count {
  font-size: 11px;
  color: var(--color-text-muted);
}

.atg-list {
  overflow-y: auto;
  padding: 6px 0;
  flex: 1;
  min-height: 60px;
}

.atg-status {
  font-size: 12px;
  color: var(--color-text-muted);
  padding: 12px 16px;
  text-align: center;
}

.atg-row {
  display: flex;
  align-items: center;
  gap: 9px;
  width: calc(100% - 8px);
  margin: 0 4px;
  padding: 7px 10px;
  border: none;
  background: transparent;
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  border-radius: 8px;
  box-sizing: border-box;
  transition: background 0.1s;
}

.atg-row:hover { background: var(--color-hover); }
.atg-row.is-checked { background: color-mix(in srgb, var(--color-accent) 10%, transparent); }

.atg-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--color-text-muted);
  flex-shrink: 0;
}

.atg-name {
  font-size: 13px;
  color: var(--color-text-primary);
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.atg-check { color: var(--color-accent); flex-shrink: 0; }

.atg-new-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  margin: 0 4px;
}

.atg-new-input {
  flex: 1;
  padding: 5px 8px;
  font-size: 13px;
  font-family: inherit;
  border: 1px solid var(--color-accent);
  border-radius: 6px;
  background: var(--color-surface-raised);
  color: var(--color-text-primary);
  outline: none;
  min-width: 0;
}

.atg-new-submit,
.atg-new-cancel {
  width: 26px;
  height: 26px;
  border-radius: 6px;
  border: none;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
  transition: opacity 0.12s;
}

.atg-new-submit {
  background: var(--color-accent);
  color: #fff;
}
.atg-new-submit:disabled { opacity: 0.45; cursor: not-allowed; }

.atg-new-cancel {
  background: var(--color-surface-raised);
  color: var(--color-text-muted);
}

.atg-footer {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-top: 1px solid var(--color-border);
}

.atg-btn-new {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  font-size: 12px;
  font-family: inherit;
  border: 1px solid var(--color-border);
  border-radius: 7px;
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: background 0.1s, color 0.1s;
}
.atg-btn-new:hover { background: var(--color-hover); color: var(--color-text-primary); }

.atg-footer-actions {
  display: flex;
  gap: 6px;
  margin-left: auto;
}

.atg-btn-cancel,
.atg-btn-apply {
  padding: 5px 12px;
  font-size: 12px;
  font-family: inherit;
  border-radius: 7px;
  border: none;
  cursor: pointer;
  font-weight: 500;
  transition: opacity 0.12s;
}

.atg-btn-cancel {
  background: var(--color-surface-raised);
  color: var(--color-text-secondary);
}
.atg-btn-cancel:hover { color: var(--color-text-primary); }

.atg-btn-apply {
  background: var(--color-accent);
  color: #fff;
}
.atg-btn-apply:disabled { opacity: 0.45; cursor: not-allowed; }

.modal-fade-enter-active,
.modal-fade-leave-active { transition: opacity 0.16s ease, transform 0.16s ease; }
.modal-fade-enter-from,
.modal-fade-leave-to     { opacity: 0; transform: scale(0.97); }
</style>
