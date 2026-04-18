<script setup lang="ts">
import { UserIcon, PawPrintIcon, EyeOffIcon, EyeIcon, PencilIcon, CheckIcon, XIcon, ChevronDownIcon, RefreshCwIcon } from 'lucide-vue-next'

definePageMeta({ middleware: 'auth' })

const route     = useRoute()
const libraryId = computed(() => route.params.library as string)

// ── Data ──────────────────────────────────────────────────────────────────────

interface SubjectSummary {
  id:           string
  type:         'person' | 'pet'
  name:         string | null
  hidden:       boolean
  photoCount:   number
  thumbnailUrl: string | null
  boundingBox:  { x: number; y: number; w: number; h: number } | null
}

const { data, pending, refresh } = await useFetch<{ subjects: SubjectSummary[] }>(
  () => `/api/v1/library/${libraryId.value}/subjects`,
)

// Re-fetch whenever the list page is mounted so cover changes set on the detail
// page are reflected immediately when the user navigates back.
onMounted(() => refresh())

const visible = computed(() => (data.value?.subjects ?? []).filter(s => !s.hidden))
const hidden  = computed(() => (data.value?.subjects ?? []).filter(s => s.hidden))

const people = computed(() => visible.value.filter(s => s.type === 'person'))
const pets   = computed(() => visible.value.filter(s => s.type === 'pet'))

const hiddenOpen = ref(false)

function subjectHref(s: SubjectSummary) {
  return `/library/${libraryId.value}/people-and-pets/${s.id}`
}

// ── Rename ────────────────────────────────────────────────────────────────────

const editingId    = ref<string | null>(null)
const editingName  = ref('')
// ref inside v-for returns an array in Vue 3; helper to get the live element
const editEl       = ref<HTMLInputElement | HTMLInputElement[] | null>(null)
function focusEditEl() {
  const el = Array.isArray(editEl.value) ? editEl.value.find(Boolean) : editEl.value
  el?.focus()
  el?.select()
}
// Prevents the blur handler from committing when the user clicks Cancel
const cancelingRef = ref(false)

function startRename(subject: SubjectSummary, event: Event) {
  event.preventDefault()
  event.stopPropagation()
  editingId.value    = subject.id
  editingName.value  = subject.name ?? ''
  cancelingRef.value = false
  nextTick(focusEditEl)
}

function cancelRename() {
  cancelingRef.value = true
  editingId.value    = null
}

async function commitRename() {
  if (!editingId.value || cancelingRef.value) return
  const id   = editingId.value
  const name = editingName.value.trim() || null
  editingId.value = null

  try {
    await $fetch(`/api/v1/subjects/${id}`, { method: 'PATCH', body: { name } })
    await refresh()
  } catch (err: any) {
    const errData = err?.data ?? err?.response?._data
    if (err?.statusCode === 409 || err?.response?.status === 409) {
      const conflicting = (errData?.data ?? errData) as { existingId: string; existingName: string }
      mergeFrom.value    = id
      mergeName.value    = name ?? ''
      mergeTarget.value  = { id: conflicting.existingId, name: conflicting.existingName }
      return
    }
    console.error('Rename failed', err)
  }
}

// ── Merge dialog ──────────────────────────────────────────────────────────────

const mergeFrom   = ref<string | null>(null)
const mergeName   = ref('')
const mergeTarget = ref<{ id: string; name: string } | null>(null)

function closeMerge() {
  mergeFrom.value   = null
  mergeTarget.value = null
}

async function confirmMerge() {
  if (!mergeFrom.value || !mergeTarget.value) return
  await $fetch(`/api/v1/subjects/${mergeFrom.value}/merge`, {
    method: 'POST',
    body: { intoId: mergeTarget.value.id, name: mergeName.value || mergeTarget.value.name },
  })
  closeMerge()
  await refresh()
}

// ── Hide / Unhide ─────────────────────────────────────────────────────────────

async function toggleHidden(subject: SubjectSummary, event: Event) {
  event.preventDefault()
  event.stopPropagation()
  const newHidden = !subject.hidden
  // Optimistic update — mutate the cached data directly so the UI responds
  // instantly without triggering a full re-fetch (which would reload all images).
  const row = data.value?.subjects.find(s => s.id === subject.id)
  if (row) row.hidden = newHidden
  try {
    await $fetch(`/api/v1/subjects/${subject.id}`, { method: 'PATCH', body: { hidden: newHidden } })
  } catch {
    // Revert on failure
    if (row) row.hidden = !newHidden
  }
}

// ── Face / pet crop CSS ───────────────────────────────────────────────────────

const THUMB_SIZE = 96

function faceStyle(s: SubjectSummary): Record<string, string> {
  if (!s.thumbnailUrl) return {}
  if (!s.boundingBox) {
    return {
      backgroundImage:    `url(${s.thumbnailUrl})`,
      backgroundSize:     'cover',
      backgroundPosition: 'center',
    }
  }

  const { x, y, w, h } = s.boundingBox
  const pad = 0.4

  const cx  = x + w / 2
  const cy  = y + h / 2
  const pw  = Math.min(w * (1 + pad * 2), 1)
  const ph  = Math.min(h * (1 + pad * 2), 1)
  const ox  = Math.max(0, Math.min(cx - pw / 2, 1 - pw))
  const oy  = Math.max(0, Math.min(cy - ph / 2, 1 - ph))

  const imgW = THUMB_SIZE / pw
  const imgH = THUMB_SIZE / ph

  return {
    backgroundImage:    `url(${s.thumbnailUrl})`,
    backgroundSize:     `${imgW}px ${imgH}px`,
    backgroundPosition: `-${ox * imgW}px -${oy * imgH}px`,
    backgroundRepeat:   'no-repeat',
  }
}
</script>

<template>
  <div class="pap-page">
    <div class="pap-header">
      <div class="pap-title-row">
        <h1 class="pap-title">People &amp; Pets</h1>
        <button class="pap-refresh-btn" title="Refresh" @click="refresh()">
          <RefreshCwIcon :size="14" />
        </button>
      </div>
      <p v-if="!pending && !people.length && !pets.length" class="pap-subtitle">
        No subjects detected yet. Run the <strong>Object Detection</strong> or
        <strong>Face Grouping</strong> job in the Dev admin to analyse your photos.
      </p>
    </div>

    <div v-if="pending" class="pap-loading">Analysing…</div>

    <template v-else>

      <!-- ── People section ──────────────────────────────────────────────── -->
      <section v-if="people.length" class="pap-section">
        <h2 class="pap-section-title">
          <UserIcon :size="15" />
          People
        </h2>
        <div class="pap-grid">
          <div v-for="s in people" :key="s.id" class="pap-card">
            <!-- Thumbnail → navigates to detail page -->
            <NuxtLink :to="subjectHref(s)" class="pap-thumb-link">
              <div class="pap-thumb" :style="faceStyle(s)">
                <UserIcon v-if="!s.thumbnailUrl" :size="28" class="pap-thumb-placeholder" />
              </div>
            </NuxtLink>

            <div class="pap-card-body">
              <template v-if="editingId === s.id">
                <input
                  ref="editEl"
                  v-model="editingName"
                  class="pap-name-input"
                  placeholder="Enter a name…"
                  @keydown.enter="commitRename"
                  @keydown.escape="cancelRename"
                  @blur="commitRename"
                />
                <div class="pap-edit-actions">
                  <button class="pap-icon-btn" title="Save" @mousedown.prevent @click.stop="commitRename">
                    <CheckIcon :size="12" />
                  </button>
                  <button class="pap-icon-btn" title="Cancel" @mousedown.prevent="cancelingRef = true" @click.stop="cancelRename">
                    <XIcon :size="12" />
                  </button>
                </div>
              </template>

              <template v-else>
                <button
                  class="pap-name-btn"
                  :class="{ 'is-unnamed': !s.name }"
                  :title="s.name ? 'Rename' : 'Add a name'"
                  @click="startRename(s, $event)"
                >
                  <PencilIcon :size="10" class="pap-name-edit-icon" />
                  {{ s.name ?? 'Unknown person' }}
                </button>
              </template>

              <span class="pap-count">{{ s.photoCount }} {{ s.photoCount === 1 ? 'photo' : 'photos' }}</span>
            </div>

            <button class="pap-hide-btn" title="Hide from People & Pets" @click="toggleHidden(s, $event)">
              <EyeOffIcon :size="13" />
            </button>
          </div>
        </div>
      </section>

      <!-- ── Pets section ────────────────────────────────────────────────── -->
      <section v-if="pets.length" class="pap-section">
        <h2 class="pap-section-title">
          <PawPrintIcon :size="15" />
          Pets
        </h2>
        <div class="pap-grid">
          <div v-for="s in pets" :key="s.id" class="pap-card">
            <NuxtLink :to="subjectHref(s)" class="pap-thumb-link">
              <div class="pap-thumb" :style="faceStyle(s)">
                <PawPrintIcon v-if="!s.thumbnailUrl" :size="28" class="pap-thumb-placeholder" />
              </div>
            </NuxtLink>

            <div class="pap-card-body">
              <template v-if="editingId === s.id">
                <input
                  ref="editEl"
                  v-model="editingName"
                  class="pap-name-input"
                  placeholder="Enter a name…"
                  @keydown.enter="commitRename"
                  @keydown.escape="cancelRename"
                  @blur="commitRename"
                />
                <div class="pap-edit-actions">
                  <button class="pap-icon-btn" title="Save" @mousedown.prevent @click.stop="commitRename">
                    <CheckIcon :size="12" />
                  </button>
                  <button class="pap-icon-btn" title="Cancel" @mousedown.prevent="cancelingRef = true" @click.stop="cancelRename">
                    <XIcon :size="12" />
                  </button>
                </div>
              </template>

              <template v-else>
                <button class="pap-name-btn" title="Rename" @click="startRename(s, $event)">
                  <PencilIcon :size="10" class="pap-name-edit-icon" />
                  {{ s.name ?? 'Unknown pet' }}
                </button>
              </template>

              <span class="pap-count">{{ s.photoCount }} {{ s.photoCount === 1 ? 'photo' : 'photos' }}</span>
            </div>

            <button class="pap-hide-btn" title="Hide" @click="toggleHidden(s, $event)">
              <EyeOffIcon :size="13" />
            </button>
          </div>
        </div>
      </section>

      <!-- ── Hidden section ─────────────────────────────────────────────── -->
      <section v-if="hidden.length" class="pap-section pap-section-hidden">
        <button class="pap-hidden-toggle" @click="hiddenOpen = !hiddenOpen">
          <ChevronDownIcon
            :size="14"
            :style="{ transform: hiddenOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }"
          />
          Hidden
          <span class="pap-hidden-count">{{ hidden.length }}</span>
        </button>

        <div v-if="hiddenOpen" class="pap-grid pap-grid-hidden">
          <div v-for="s in hidden" :key="s.id" class="pap-card pap-card-hidden">
            <NuxtLink :to="subjectHref(s)" class="pap-thumb-link">
              <div class="pap-thumb" :style="faceStyle(s)">
                <component
                  :is="s.type === 'person' ? UserIcon : PawPrintIcon"
                  v-if="!s.thumbnailUrl"
                  :size="28"
                  class="pap-thumb-placeholder"
                />
              </div>
            </NuxtLink>

            <div class="pap-card-body">
              <span class="pap-name-btn is-unnamed">
                {{ s.name ?? (s.type === 'person' ? 'Unknown person' : 'Unknown pet') }}
              </span>
              <span class="pap-count">{{ s.photoCount }} {{ s.photoCount === 1 ? 'photo' : 'photos' }}</span>
            </div>

            <button class="pap-hide-btn" title="Unhide" @click="toggleHidden(s, $event)">
              <EyeIcon :size="13" />
            </button>
          </div>
        </div>
      </section>

    </template>

    <!-- ── Merge confirmation dialog ──────────────────────────────────────── -->
    <Teleport to="body">
      <div v-if="mergeTarget" class="pap-merge-backdrop" @click.self="closeMerge">
        <div class="pap-merge-dialog" role="dialog" aria-modal="true">
          <h3 class="pap-merge-title">Combine?</h3>
          <p class="pap-merge-body">
            <strong>{{ mergeTarget.name }}</strong> already exists.
            Combine both into one entry named:
          </p>
          <input
            v-model="mergeName"
            class="pap-name-input pap-merge-input"
            :placeholder="mergeTarget.name"
          />
          <div class="pap-merge-actions">
            <button class="pap-merge-btn pap-merge-btn-cancel" @click="closeMerge">Keep separate</button>
            <button class="pap-merge-btn pap-merge-btn-confirm" @click="confirmMerge">Combine</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.pap-page {
  padding: 28px 32px;
  max-width: 1100px;
}

.pap-header { margin-bottom: 28px; }

.pap-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 6px;
}

.pap-title {
  font-size: 22px;
  font-weight: 700;
  color: var(--color-text-primary);
  margin: 0;
}

.pap-refresh-btn {
  display: flex;
  align-items: center;
  color: var(--color-text-muted);
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 5px;
  transition: color 0.1s, background 0.1s;
}

.pap-refresh-btn:hover { color: var(--color-text-primary); background: var(--color-hover); }

.pap-subtitle {
  font-size: 13px;
  color: var(--color-text-muted);
  margin: 0;
}

.pap-loading { font-size: 13px; color: var(--color-text-muted); }

.pap-section { margin-bottom: 36px; }

.pap-section-title {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin: 0 0 14px;
}

.pap-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 16px;
}

.pap-card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.pap-card:hover .pap-hide-btn { opacity: 1; }

.pap-thumb-link {
  display: block;
  text-decoration: none;
  border-radius: 50%;
}

.pap-thumb {
  width: 96px;
  height: 96px;
  box-sizing: border-box;      /* border included in 96px so pixel math is exact */
  border-radius: 50%;
  overflow: hidden;
  background-color: var(--color-surface-raised);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border: 2px solid var(--color-border);
  transition: border-color 0.15s;
}

.pap-thumb-link:hover .pap-thumb { border-color: var(--color-accent); }
.pap-card-hidden .pap-thumb { opacity: 0.4; }

.pap-thumb-placeholder { color: var(--color-text-muted); opacity: 0.5; }

.pap-card-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  width: 100%;
  min-width: 0;
  text-align: center;
}

.pap-name-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-primary);
  background: none;
  border: none;
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 4px;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: background 0.1s;
  font-family: inherit;
}

.pap-name-btn:hover { background: var(--color-hover); }
.pap-name-btn.is-unnamed { color: var(--color-text-muted); font-weight: 500; }

.pap-name-edit-icon { opacity: 0; flex-shrink: 0; transition: opacity 0.1s; }
.pap-name-btn:hover .pap-name-edit-icon { opacity: 0.6; }

.pap-name-input {
  width: 100%;
  padding: 3px 6px;
  font-size: 12px;
  font-weight: 600;
  font-family: inherit;
  border: 1px solid var(--color-accent);
  border-radius: 5px;
  background: var(--color-surface-raised);
  color: var(--color-text-primary);
  outline: none;
  text-align: center;
  box-sizing: border-box;
}

.pap-edit-actions { display: flex; gap: 4px; justify-content: center; }

.pap-icon-btn {
  width: 22px;
  height: 22px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  background: var(--color-surface-raised);
  color: var(--color-text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.1s;
}

.pap-icon-btn:hover { background: var(--color-hover); }

.pap-count { font-size: 11px; color: var(--color-text-muted); }

.pap-hide-btn {
  position: absolute;
  top: 0;
  right: 4px;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: none;
  background: var(--color-surface-overlay);
  color: var(--color-text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.15s, background 0.1s;
  box-shadow: 0 1px 4px rgba(0,0,0,0.2);
}

.pap-hide-btn:hover { background: var(--color-hover); color: var(--color-text-primary); }

.pap-section-hidden {
  margin-top: 8px;
  padding-top: 20px;
  border-top: 1px solid var(--color-border);
}

.pap-hidden-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px 0;
  margin-bottom: 14px;
  font-family: inherit;
}

.pap-hidden-count {
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border);
  border-radius: 10px;
  padding: 0 7px;
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-muted);
  min-width: 20px;
  text-align: center;
}

.pap-grid-hidden { opacity: 0.7; }

/* ── Merge dialog ────────────────────────────────────────────────────────── */
.pap-merge-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 500;
}

.pap-merge-dialog {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 12px;
  padding: 24px 28px;
  width: 320px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
}

.pap-merge-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--color-text-primary);
  margin: 0 0 10px;
}

.pap-merge-body {
  font-size: 13px;
  color: var(--color-text-secondary);
  margin: 0 0 14px;
  line-height: 1.5;
}

.pap-merge-input { margin-bottom: 16px; text-align: left; }

.pap-merge-actions { display: flex; gap: 8px; justify-content: flex-end; }

.pap-merge-btn {
  padding: 6px 14px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  border: 1px solid var(--color-border);
  transition: background 0.1s;
}

.pap-merge-btn-cancel {
  background: var(--color-surface-raised);
  color: var(--color-text-secondary);
}

.pap-merge-btn-cancel:hover { background: var(--color-hover); }

.pap-merge-btn-confirm {
  background: var(--color-accent);
  color: #fff;
  border-color: var(--color-accent);
}

.pap-merge-btn-confirm:hover { opacity: 0.88; }
</style>
