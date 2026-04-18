<script setup lang="ts">
import { onClickOutside, useLocalStorage } from '@vueuse/core'
import {
  XIcon, SunIcon, MoonIcon, MonitorIcon, CircleIcon,
  PaletteIcon, HardDriveIcon, UserIcon, ShieldIcon, RefreshCwIcon,
  SparklesIcon, LayoutGridIcon,
} from 'lucide-vue-next'
import type { AppTheme } from '~/composables/useAppShell'
import type { GalleryMode, GallerySize, GalleryGap } from '~/composables/useGallery'

const { settingsOpen, theme, closeSettings, setTheme } = useAppShell()
const { galleryMode, gallerySize, galleryGap, setMode, setSize, setGap } = useGallery()

// Admin check (user id === 1 is the first/admin user)
const { user } = useUserSession()
const isAdmin = computed(() => (user.value as { id?: number } | null)?.id === 1)

// Day groupings toggle (wired to the same key used by GallerySection)
const showDayGroups = useLocalStorage('gallery-show-day-groups', true)

// ── Preview settings (admin-only) ─────────────────────────────────────────────
const showObjectBoxes = useLocalStorage('preview-show-object-boxes', false)

// ── AI / Features settings ────────────────────────────────────────────────────
const aiEnabled              = useLocalStorage('features-ai-enabled',              false)
const aiPhotoStacking        = useLocalStorage('features-ai-photo-stacking',       false)
const aiObjectFaceDetection  = useLocalStorage('features-ai-object-face',          false)
const aiSummaryCategorize    = useLocalStorage('features-ai-summary-categorize',   false)
const aiAlbumCuration        = useLocalStorage('features-ai-album-curation',       false)
const aiArchivingNudging     = useLocalStorage('features-ai-archiving-nudging',    false)
const aiBackgroundRemoval    = useLocalStorage('features-ai-background-removal',   false)

const panelEl = ref<HTMLElement | null>(null)
onClickOutside(panelEl, () => closeSettings())

onMounted(()   => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && settingsOpen.value) closeSettings()
}

// ── Sidebar tabs ──────────────────────────────────────────────────────────────
type TabId = 'appearance' | 'features' | 'storage' | 'account' | 'admin' | 'sync'

interface Tab {
  id:    TabId
  label: string
  icon:  unknown
}

const tabs: Tab[] = [
  { id: 'appearance', label: 'Appearance', icon: PaletteIcon   },
  { id: 'features',   label: 'Features',   icon: LayoutGridIcon },
  { id: 'storage',    label: 'Storage',    icon: HardDriveIcon },
  { id: 'account',    label: 'Account',    icon: UserIcon      },
  { id: 'admin',      label: 'Admin',      icon: ShieldIcon    },
  { id: 'sync',       label: 'Sync',       icon: RefreshCwIcon },
]

const activeTab = ref<TabId>('appearance')

// ── Theme / size / gap options ────────────────────────────────────────────────
const themes: { value: AppTheme; label: string; icon: unknown }[] = [
  { value: 'light',  label: 'Light',  icon: SunIcon    },
  { value: 'dark',   label: 'Dark',   icon: MoonIcon   },
  { value: 'black',  label: 'Black',  icon: CircleIcon },
  { value: 'system', label: 'System', icon: MonitorIcon },
]

const sizes: { value: GallerySize; label: string }[] = [
  { value: 'xs', label: 'XS' },
  { value: 'sm', label: 'S'  },
  { value: 'md', label: 'M'  },
  { value: 'lg', label: 'L'  },
  { value: 'xl', label: 'XL' },
]

const gaps: { value: GalleryGap; label: string }[] = [
  { value: 'tight',  label: 'Tight'  },
  { value: 'normal', label: 'Normal' },
  { value: 'loose',  label: 'Loose'  },
]

const modes: { value: GalleryMode; label: string }[] = [
  { value: 'masonry', label: 'Masonry' },
  { value: 'grid',    label: 'Grid'    },
]
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div
        v-if="settingsOpen"
        class="settings-backdrop"
        aria-modal="true"
        role="dialog"
        aria-label="Settings"
      >
        <div ref="panelEl" class="settings-panel">

          <!-- Header -->
          <div class="settings-header">
            <h2 class="settings-title">Settings</h2>
            <button class="settings-close" aria-label="Close settings" @click="closeSettings">
              <XIcon :size="18" />
            </button>
          </div>

          <!-- Two-pane body: sidebar + content -->
          <div class="settings-body">

            <!-- Left sidebar tabs -->
            <nav class="settings-sidebar" aria-label="Settings sections">
              <button
                v-for="tab in tabs"
                :key="tab.id"
                class="settings-tab-btn"
                :class="{ 'is-active': activeTab === tab.id }"
                @click="activeTab = tab.id"
              >
                <component :is="tab.icon" :size="16" class="settings-tab-icon" />
                <span>{{ tab.label }}</span>
              </button>
            </nav>

            <!-- Right content pane -->
            <div class="settings-content">

              <!-- ── Appearance ─────────────────────────────────────── -->
              <template v-if="activeTab === 'appearance'">

                <section class="settings-section">
                  <h3 class="settings-section-title">Theme</h3>
                  <div class="settings-theme-grid">
                    <button
                      v-for="t in themes"
                      :key="t.value"
                      class="settings-theme-btn"
                      :class="{ 'is-active': theme === t.value }"
                      @click="setTheme(t.value)"
                    >
                      <component :is="t.icon" :size="16" />
                      <span>{{ t.label }}</span>
                    </button>
                  </div>
                </section>

                <section class="settings-section">
                  <h3 class="settings-section-title">Gallery</h3>

                  <div class="settings-field">
                    <label class="settings-label">Mode</label>
                    <div class="settings-size-row">
                      <button
                        v-for="m in modes"
                        :key="m.value"
                        class="settings-size-btn"
                        :class="{ 'is-active': galleryMode === m.value }"
                        @click="setMode(m.value)"
                      >
                        {{ m.label }}
                      </button>
                    </div>
                  </div>

                  <div class="settings-field">
                    <label class="settings-label">Preview size</label>
                    <div class="settings-size-row">
                      <button
                        v-for="s in sizes"
                        :key="s.value"
                        class="settings-size-btn"
                        :class="{ 'is-active': gallerySize === s.value }"
                        @click="setSize(s.value)"
                      >
                        {{ s.label }}
                      </button>
                    </div>
                  </div>

                  <div class="settings-field">
                    <label class="settings-label">Spacing</label>
                    <div class="settings-gap-row">
                      <button
                        v-for="g in gaps"
                        :key="g.value"
                        class="settings-gap-btn"
                        :class="{ 'is-active': galleryGap === g.value }"
                        @click="setGap(g.value)"
                      >
                        {{ g.label }}
                      </button>
                    </div>
                  </div>

                  <div class="settings-field">
                    <label class="settings-label settings-toggle-label">
                      Day groupings
                      <button
                        class="settings-toggle"
                        :class="{ 'is-on': showDayGroups }"
                        role="switch"
                        :aria-checked="showDayGroups"
                        @click="showDayGroups = !showDayGroups"
                      >
                        <span class="settings-toggle-thumb" />
                      </button>
                    </label>
                    <p class="settings-hint">Group photos by day inside each month</p>
                  </div>
                </section>

                <!-- Preview section — admin only -->
                <section v-if="isAdmin" class="settings-section">
                  <h3 class="settings-section-title">Preview</h3>
                  <div class="settings-field">
                    <label class="settings-label settings-toggle-label">
                      Show object detection hitboxes
                      <button
                        class="settings-toggle"
                        :class="{ 'is-on': showObjectBoxes }"
                        role="switch"
                        :aria-checked="showObjectBoxes"
                        @click="showObjectBoxes = !showObjectBoxes"
                      >
                        <span class="settings-toggle-thumb" />
                      </button>
                    </label>
                    <p class="settings-hint">Overlay COCO-SSD detected object bounding boxes and labels on image previews</p>
                  </div>
                </section>

              </template>

              <!-- ── Features ──────────────────────────────────────────────── -->
              <template v-else-if="activeTab === 'features'">

                <section class="settings-section">
                  <h3 class="settings-section-title">AI Features</h3>

                  <div class="settings-ai-notice">
                    <SparklesIcon :size="14" class="settings-ai-notice-icon" />
                    <p class="settings-ai-notice-text">
                      AI features are recommended only for users with a dedicated GPU for local models, or those who wish to bring their own API key (not recommended for most users).
                    </p>
                  </div>

                  <!-- Master switch -->
                  <div class="settings-field settings-ai-master">
                    <label class="settings-label settings-toggle-label">
                      <span class="settings-ai-master-label">
                        <SparklesIcon :size="14" />
                        Enable AI features
                      </span>
                      <button
                        class="settings-toggle"
                        :class="{ 'is-on': aiEnabled }"
                        role="switch"
                        :aria-checked="aiEnabled"
                        @click="aiEnabled = !aiEnabled"
                      >
                        <span class="settings-toggle-thumb" />
                      </button>
                    </label>
                    <p class="settings-hint">Master switch — overrides all individual AI settings below</p>
                  </div>

                  <div class="settings-ai-features" :class="{ 'is-disabled': !aiEnabled }">

                    <div class="settings-field">
                      <label class="settings-label settings-toggle-label">
                        Photo stacking &amp; de-duplication
                        <button
                          class="settings-toggle"
                          :class="{ 'is-on': aiPhotoStacking && aiEnabled }"
                          :disabled="!aiEnabled"
                          role="switch"
                          :aria-checked="aiPhotoStacking && aiEnabled"
                          @click="aiPhotoStacking = !aiPhotoStacking"
                        >
                          <span class="settings-toggle-thumb" />
                        </button>
                      </label>
                      <p class="settings-hint">Automatically group near-duplicate photos and surface the best shot</p>
                    </div>

                    <div class="settings-field">
                      <label class="settings-label settings-toggle-label">
                        Object &amp; face detection
                        <button
                          class="settings-toggle"
                          :class="{ 'is-on': aiObjectFaceDetection && aiEnabled }"
                          :disabled="!aiEnabled"
                          role="switch"
                          :aria-checked="aiObjectFaceDetection && aiEnabled"
                          @click="aiObjectFaceDetection = !aiObjectFaceDetection"
                        >
                          <span class="settings-toggle-thumb" />
                        </button>
                      </label>
                      <p class="settings-hint">Detect and identify people, pets, and objects in your photos</p>
                    </div>

                    <div class="settings-field">
                      <label class="settings-label settings-toggle-label">
                        Summary &amp; categorization
                        <button
                          class="settings-toggle"
                          :class="{ 'is-on': aiSummaryCategorize && aiEnabled }"
                          :disabled="!aiEnabled"
                          role="switch"
                          :aria-checked="aiSummaryCategorize && aiEnabled"
                          @click="aiSummaryCategorize = !aiSummaryCategorize"
                        >
                          <span class="settings-toggle-thumb" />
                        </button>
                      </label>
                      <p class="settings-hint">Generate natural-language summaries and auto-categorize collections</p>
                    </div>

                    <div class="settings-field">
                      <label class="settings-label settings-toggle-label">
                        Album curation
                        <button
                          class="settings-toggle"
                          :class="{ 'is-on': aiAlbumCuration && aiEnabled }"
                          :disabled="!aiEnabled"
                          role="switch"
                          :aria-checked="aiAlbumCuration && aiEnabled"
                          @click="aiAlbumCuration = !aiAlbumCuration"
                        >
                          <span class="settings-toggle-thumb" />
                        </button>
                      </label>
                      <p class="settings-hint">Suggest and automatically create albums from events and themes</p>
                    </div>

                    <div class="settings-field">
                      <label class="settings-label settings-toggle-label">
                        Smart archiving &amp; nudging
                        <button
                          class="settings-toggle"
                          :class="{ 'is-on': aiArchivingNudging && aiEnabled }"
                          :disabled="!aiEnabled"
                          role="switch"
                          :aria-checked="aiArchivingNudging && aiEnabled"
                          @click="aiArchivingNudging = !aiArchivingNudging"
                        >
                          <span class="settings-toggle-thumb" />
                        </button>
                      </label>
                      <p class="settings-hint">Proactively suggest archiving low-quality or redundant shots</p>
                    </div>

                    <div class="settings-field">
                      <label class="settings-label settings-toggle-label">
                        <span>
                          Background removal
                          <span class="settings-badge">Experimental</span>
                        </span>
                        <button
                          class="settings-toggle"
                          :class="{ 'is-on': aiBackgroundRemoval && aiEnabled }"
                          :disabled="!aiEnabled"
                          role="switch"
                          :aria-checked="aiBackgroundRemoval && aiEnabled"
                          @click="aiBackgroundRemoval = !aiBackgroundRemoval"
                        >
                          <span class="settings-toggle-thumb" />
                        </button>
                      </label>
                      <p class="settings-hint">Remove or replace backgrounds from portraits and product shots</p>
                    </div>

                  </div><!-- /.settings-ai-features -->
                </section>

              </template>

              <!-- ── Storage ────────────────────────────────────────────── -->
              <template v-else-if="activeTab === 'storage'">
                <AppStorageTab />
              </template>

              <!-- ── Account (stub) ───────────────────────────────────── -->
              <template v-else-if="activeTab === 'account'">
                <section class="settings-section">
                  <h3 class="settings-section-title">Account</h3>
                  <p class="settings-coming-soon">Account settings coming soon.</p>
                </section>
              </template>

              <!-- ── Admin (stub) ─────────────────────────────────────── -->
              <template v-else-if="activeTab === 'admin'">
                <section class="settings-section">
                  <h3 class="settings-section-title">Admin</h3>
                  <p class="settings-coming-soon">Admin settings coming soon.</p>
                </section>
              </template>

              <!-- ── Sync ────────────────────────────────────────────────────────── -->
              <template v-else-if="activeTab === 'sync'">
                <section class="settings-section">
                  <h3 class="settings-section-title">Background sync</h3>
                  <p class="settings-hint" style="margin-bottom:12px">
                    Automatic sync is available in the Electron desktop app and mobile apps.
                    On web, uploads are manual only.
                  </p>
                  <div class="settings-sync-disabled">
                    <span style="font-size:13px;color:var(--color-text-muted)">Sync is not available in this browser session.</span>
                  </div>
                </section>
                <section class="settings-section">
                  <h3 class="settings-section-title">Libraries to sync to from this device</h3>
                  <p class="settings-hint">
                    When background sync runs, new photos found on this device will be uploaded to the selected libraries.
                    Different devices can have independent sync targets.
                  </p>
                  <p class="settings-coming-soon" style="opacity:0.5">
                    Configure sync targets when using the desktop or mobile app.
                  </p>
                </section>
              </template>

            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.settings-sync-disabled {
  padding: 12px 14px;
  border-radius: 8px;
  border: 1px dashed var(--color-border);
  background: var(--color-surface-raised, var(--color-surface));
  text-align: center;
}

/* ── AI features notice ─────────────────────────────────────────────────────── */
.settings-ai-notice {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border);
  margin-bottom: 16px;
}

.settings-ai-notice-icon {
  color: var(--color-text-muted);
  flex-shrink: 0;
  margin-top: 1px;
}

.settings-ai-notice-text {
  font-size: 12px;
  color: var(--color-text-muted);
  margin: 0;
  line-height: 1.5;
}

/* Master switch row */
.settings-ai-master {
  padding-bottom: 16px;
  border-bottom: 1px solid var(--color-border);
  margin-bottom: 4px;
}

.settings-ai-master-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
  color: var(--color-text-primary);
}

/* Individual feature rows */
.settings-ai-features {
  display: flex;
  flex-direction: column;
  transition: opacity 0.15s;
}

.settings-ai-features.is-disabled {
  opacity: 0.45;
  pointer-events: none;
}

/* Experimental badge */
.settings-badge {
  display: inline-flex;
  align-items: center;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.04em;
  background: var(--color-accent, #6366f1);
  color: #fff;
  margin-left: 6px;
  vertical-align: middle;
}
</style>
