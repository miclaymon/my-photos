<template>
  <div class="app-shell">
    <AppHeader />
    <div class="app-body">
      <AppSideNav />
      <main id="main-content" class="app-main">
        <slot />
      </main>
    </div>
  </div>

  <!-- Global overlays (available on all authenticated pages) -->
  <AppSettingsModal />
  <AppUploadOverlay />
  <AppLibraryPicker />
  <AppUploadToast />
  <AppToast />
  <AppDragGhost />
  <AppDragZoneOverlay />
  <AppDuplicateConflictModal />
  <AppCreateLibraryModal />
</template>
