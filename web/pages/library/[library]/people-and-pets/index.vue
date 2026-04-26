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
  petClass:     string[] | null
  photoCount:   number
  thumbnailUrl: string | null
  boundingBox:  { x: number; y: number; w: number; h: number } | null
}

function mapSubject(raw: Record<string, unknown>): SubjectSummary {
  return {
    id:           raw.id           as string,
    type:         raw.type         as 'person' | 'pet',
    name:         raw.name         as string | null,
    hidden:       raw.hidden       as boolean,
    petClass:     (raw.pet_class   as string[] | null) ?? null,
    photoCount:   raw.photo_count  as number,
    thumbnailUrl: raw.thumbnail_url as string | null,
    boundingBox:  raw.bounding_box as { x: number; y: number; w: number; h: number } | null,
  }
}

const { data: rawData, pending, refresh: rawRefresh } = await useFetch<{ subjects: Record<string, unknown>[] }>(
  () => `/api/v1/library/${libraryId.value}/subjects`,
)

const data = computed(() => ({
  subjects: (rawData.value?.subjects ?? []).map(mapSubject),
}))

async function refresh() {
  await rawRefresh()
}

// Re-fetch whenever the list page is mounted so cover changes set on the detail
// page are reflected immediately when the user navigates back.
onMounted(() => {
  refresh()
  window.addEventListener('mousemove', onWindowMousemove)
  window.addEventListener('mouseup',   onWindowMouseup)
})

onUnmounted(() => {
  window.removeEventListener('mousemove', onWindowMousemove)
  window.removeEventListener('mouseup',   onWindowMouseup)
  removeDragGhost()
})

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
    const status   = err?.statusCode ?? err?.response?.status
    const errData  = err?.data ?? err?.response?._data
    if (status === 409) {
      // Name conflict — ask the user if these are the same person
      const detail = errData?.detail ?? errData
      const existingSubject = (data.value?.subjects ?? []).find(s => s.id === detail?.existing_id)
      mergeFrom.value    = id
      mergeName.value    = name ?? ''
      mergeContext.value = 'rename'
      mergeTarget.value  = {
        id:           detail?.existing_id  ?? '',
        name:         detail?.existing_name ?? name ?? '',
        thumbnailUrl: existingSubject?.thumbnailUrl ?? null,
      }
      return
    }
    console.error('Rename failed', err)
  }
}

// ── Merge dialog ──────────────────────────────────────────────────────────────

interface MergeTarget { id: string; name: string; thumbnailUrl?: string | null }

const mergeFrom    = ref<string | null>(null)
const mergeName    = ref('')
const mergeTarget  = ref<MergeTarget | null>(null)
const mergeContext = ref<'rename' | 'drag'>('rename')

const mergeSourceSubject = computed(() =>
  mergeFrom.value ? (data.value?.subjects ?? []).find(s => s.id === mergeFrom.value) ?? null : null
)

function closeMerge() {
  mergeFrom.value   = null
  mergeTarget.value = null
}

/** Keep separate: force-rename the source subject without merging. */
async function keepSeparate() {
  if (!mergeFrom.value) return
  const id   = mergeFrom.value
  const name = mergeName.value || null
  closeMerge()
  try {
    await $fetch(`/api/v1/subjects/${id}`, { method: 'PATCH', body: { name, force: true } })
    await refresh()
  } catch (err) {
    console.error('Force rename failed', err)
  }
}

/** Merge: absorb mergeFrom into mergeTarget (target survives). */
async function confirmMerge() {
  if (!mergeFrom.value || !mergeTarget.value) return
  // The target (URL) survives; the source (body.merge_subject_id) is absorbed + deleted.
  await $fetch(`/api/v1/subjects/${mergeTarget.value.id}/merge`, {
    method: 'POST',
    body: { merge_subject_id: mergeFrom.value, name: mergeName.value || mergeTarget.value.name },
  })
  closeMerge()
  await refresh()
}

// ── Drag-to-merge ─────────────────────────────────────────────────────────────

const dragSubject = ref<SubjectSummary | null>(null)
const dragOverId  = ref<string | null>(null)
const isDragging  = ref(false)
let dragStartX    = 0
let dragStartY    = 0
let dragGhostEl: HTMLElement | null = null
const DRAG_THRESHOLD = 8

function onThumbMousedown(s: SubjectSummary, e: MouseEvent) {
  if (e.button !== 0) return
  if (editingId.value) return       // don't drag while a rename input is open
  if (mergeTarget.value) return     // don't drag while merge dialog is open
  dragSubject.value = s
  dragStartX        = e.clientX
  dragStartY        = e.clientY
  isDragging.value  = false
}

function onWindowMousemove(e: MouseEvent) {
  if (!dragSubject.value) return

  const dx = e.clientX - dragStartX
  const dy = e.clientY - dragStartY

  if (!isDragging.value) {
    if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return
    isDragging.value = true
    createDragGhost(dragSubject.value, e.clientX, e.clientY)
  }

  moveDragGhost(e.clientX, e.clientY)

  // Hit-test: find the card element under the cursor
  const els = document.elementsFromPoint(e.clientX, e.clientY)
  let overId: string | null = null
  for (const el of els) {
    const card = (el as HTMLElement).closest('[data-subject-id]') as HTMLElement | null
    if (card) {
      const id = card.dataset.subjectId
      if (id && id !== dragSubject.value!.id) {
        const t = (data.value?.subjects ?? []).find(s => s.id === id)
        if (t?.type === dragSubject.value!.type) { overId = id }
        break
      }
    }
  }
  dragOverId.value = overId
}

function onWindowMouseup(e: MouseEvent) {
  if (!dragSubject.value) return

  const source = dragSubject.value

  if (isDragging.value && dragOverId.value) {
    // Drop on a target card — open merge dialog
    const target = (data.value?.subjects ?? []).find(s => s.id === dragOverId.value)
    if (target && target.type === source.type) {
      mergeFrom.value    = source.id
      mergeTarget.value  = { id: target.id, name: target.name ?? 'Unknown', thumbnailUrl: target.thumbnailUrl }
      mergeName.value    = target.name ?? source.name ?? ''
      mergeContext.value = 'drag'
    }
  } else if (!isDragging.value) {
    // Plain click — navigate to the subject's detail page
    navigateTo(subjectHref(source))
  }

  removeDragGhost()
  dragSubject.value = null
  dragOverId.value  = null
  isDragging.value  = false
}

function createDragGhost(s: SubjectSummary, x: number, y: number) {
  const el = document.createElement('div')
  el.className = 'pap-drag-ghost'
  if (s.thumbnailUrl) {
    el.style.backgroundImage    = `url(${s.thumbnailUrl})`
    el.style.backgroundSize     = '100%'
    el.style.backgroundPosition = 'center center'
    el.style.backgroundRepeat   = 'no-repeat'
  }
  el.style.left = `${x - 48}px`
  el.style.top  = `${y - 48}px`
  document.body.appendChild(el)
  dragGhostEl = el
}

function moveDragGhost(x: number, y: number) {
  if (dragGhostEl) {
    dragGhostEl.style.left = `${x - 48}px`
    dragGhostEl.style.top  = `${y - 48}px`
  }
}

function removeDragGhost() {
  dragGhostEl?.remove()
  dragGhostEl = null
}

// ── Hide / Unhide ─────────────────────────────────────────────────────────────

async function toggleHidden(subject: SubjectSummary, event: Event) {
  event.preventDefault()
  event.stopPropagation()
  const newHidden = !subject.hidden
  // Optimistic update — mutate the raw fetched data directly
  const row = rawData.value?.subjects.find(s => (s as Record<string, unknown>).id === subject.id) as Record<string, unknown> | undefined
  if (row) row.hidden = newHidden
  try {
    await $fetch(`/api/v1/subjects/${subject.id}`, { method: 'PATCH', body: { hidden: newHidden } })
  } catch {
    // Revert on failure
    if (row) row.hidden = !newHidden
  }
}

// ── Face / pet crop CSS ───────────────────────────────────────────────────────


function faceStyle(s: SubjectSummary): Record<string, string> {
  if (!s.thumbnailUrl) return {}
  return {
    backgroundImage:    `url(${s.thumbnailUrl})`,
    backgroundRepeat:   'no-repeat',
    backgroundSize:     '100%',
    backgroundPosition: 'center center',
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
          <div
            v-for="s in people"
            :key="s.id"
            class="pap-card"
            :class="{
              'is-drag-source': isDragging && dragSubject?.id === s.id,
              'is-drag-over':   dragOverId === s.id,
            }"
            :data-subject-id="s.id"
          >
            <!-- Thumbnail — drag initiates here; plain click navigates (handled in mouseup) -->
            <div
              class="pap-thumb-link"
              :title="isDragging ? undefined : 'View collection'"
              @mousedown.left.stop="onThumbMousedown(s, $event)"
            >
              <div class="pap-thumb" :style="faceStyle(s)">
                <UserIcon v-if="!s.thumbnailUrl" :size="28" class="pap-thumb-placeholder" />
              </div>
            </div>

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
                  @mousedown.stop
                  @click="startRename(s, $event)"
                >
                  <PencilIcon :size="10" class="pap-name-edit-icon" />
                  {{ s.name ?? 'Unknown person' }}
                </button>
              </template>

              <span class="pap-count">{{ s.photoCount }} {{ s.photoCount === 1 ? 'photo' : 'photos' }}</span>
            </div>

            <button class="pap-hide-btn" title="Hide from People & Pets" @mousedown.stop @click="toggleHidden(s, $event)">
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
          <div
            v-for="s in pets"
            :key="s.id"
            class="pap-card"
            :class="{
              'is-drag-source': isDragging && dragSubject?.id === s.id,
              'is-drag-over':   dragOverId === s.id,
            }"
            :data-subject-id="s.id"
          >
            <div
              class="pap-thumb-link"
              @mousedown.left.stop="onThumbMousedown(s, $event)"
            >
              <div class="pap-thumb" :style="faceStyle(s)">
                <PawPrintIcon v-if="!s.thumbnailUrl" :size="28" class="pap-thumb-placeholder" />
              </div>
            </div>

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
                <button class="pap-name-btn" title="Rename" @mousedown.stop @click="startRename(s, $event)">
                  <PencilIcon :size="10" class="pap-name-edit-icon" />
                  {{ s.name ?? 'Unknown pet' }}
                </button>
              </template>

              <span class="pap-count">{{ s.photoCount }} {{ s.photoCount === 1 ? 'photo' : 'photos' }}</span>
            </div>

            <button class="pap-hide-btn" title="Hide" @mousedown.stop @click="toggleHidden(s, $event)">
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
          <div
            v-for="s in hidden"
            :key="s.id"
            class="pap-card pap-card-hidden"
            :data-subject-id="s.id"
          >
            <div class="pap-thumb-link" @mousedown.left.stop="onThumbMousedown(s, $event)">
              <div class="pap-thumb" :style="faceStyle(s)">
                <component
                  :is="s.type === 'person' ? UserIcon : PawPrintIcon"
                  v-if="!s.thumbnailUrl"
                  :size="28"
                  class="pap-thumb-placeholder"
                />
              </div>
            </div>

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
          <h3 class="pap-merge-title">
            {{ mergeContext === 'rename' ? 'Same person?' : 'Combine collections?' }}
          </h3>

          <!-- Face thumbnail pair -->
          <div class="pap-merge-faces">
            <div class="pap-merge-face">
              <div
                class="pap-merge-thumb"
                :style="mergeSourceSubject?.thumbnailUrl
                  ? { backgroundImage: `url(${mergeSourceSubject.thumbnailUrl})`, backgroundSize: '100%', backgroundPosition: 'center', backgroundRepeat: 'no-repeat' }
                  : {}"
              >
                <UserIcon v-if="!mergeSourceSubject?.thumbnailUrl" :size="20" />
              </div>
              <span class="pap-merge-face-label">{{ mergeSourceSubject?.name ?? 'Unknown' }}</span>
            </div>
            <span class="pap-merge-arrow">→</span>
            <div class="pap-merge-face">
              <div
                class="pap-merge-thumb"
                :style="mergeTarget.thumbnailUrl
                  ? { backgroundImage: `url(${mergeTarget.thumbnailUrl})`, backgroundSize: '100%', backgroundPosition: 'center', backgroundRepeat: 'no-repeat' }
                  : {}"
              >
                <UserIcon v-if="!mergeTarget.thumbnailUrl" :size="20" />
              </div>
              <span class="pap-merge-face-label">{{ mergeTarget.name }}</span>
            </div>
          </div>

          <p class="pap-merge-body">
            <template v-if="mergeContext === 'rename'">
              <strong>{{ mergeTarget.name }}</strong> already exists. Are these the same person?
              Combining will move all photos into one collection.
            </template>
            <template v-else>
              Move all photos from <strong>{{ mergeSourceSubject?.name ?? 'this collection' }}</strong>
              into <strong>{{ mergeTarget.name }}</strong> and combine into one collection.
            </template>
          </p>

          <label class="pap-merge-name-label">Name for the combined collection</label>
          <input
            v-model="mergeName"
            class="pap-name-input pap-merge-input"
            :placeholder="mergeTarget.name"
          />
          <div class="pap-merge-actions">
            <button
              class="pap-merge-btn pap-merge-btn-cancel"
              @click="mergeContext === 'rename' ? keepSeparate() : closeMerge()"
            >
              {{ mergeContext === 'rename' ? 'Keep separate' : 'Cancel' }}
            </button>
            <button class="pap-merge-btn pap-merge-btn-confirm" @click="confirmMerge">
              {{ mergeContext === 'rename' ? 'Yes, combine' : 'Combine' }}
            </button>
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

/* ── Merge dialog — face thumbnails ────────────────────────────────────────── */
.pap-merge-faces {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  margin-bottom: 14px;
}

.pap-merge-face {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
}

.pap-merge-thumb {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: var(--color-surface-raised);
  border: 2px solid var(--color-border);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-muted);
  flex-shrink: 0;
}

.pap-merge-face-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-secondary);
  max-width: 72px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: center;
}

.pap-merge-arrow {
  font-size: 18px;
  color: var(--color-text-muted);
  flex-shrink: 0;
}

.pap-merge-name-label {
  display: block;
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 6px;
}

/* ── Drag-to-merge ─────────────────────────────────────────────────────────── */
.pap-card.is-drag-source { opacity: 0.35; }

.pap-card.is-drag-over .pap-thumb {
  border-color: var(--color-accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-accent) 30%, transparent);
}

/* Ghost element is appended to body — must use :global */
:global(.pap-drag-ghost) {
  position: fixed;
  width: 96px;
  height: 96px;
  border-radius: 50%;
  background-color: var(--color-surface-raised, #eee);
  background-size: 100%;
  background-position: center;
  background-repeat: no-repeat;
  border: 3px solid var(--color-accent, #6366f1);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  opacity: 0.9;
  pointer-events: none;
  z-index: 9999;
  cursor: grabbing;
  transform: scale(1.08);
}
</style>
