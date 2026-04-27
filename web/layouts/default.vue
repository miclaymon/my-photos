<template>
  <div class="app-shell">
    <AppHeader />
    <div class="app-body">
      <AppSideNav />
      <main id="main-content" class="app-main">
        <ClientOnly>
          <slot />
        </ClientOnly>
      </main>
    </div>
  </div>

  <!-- Global overlays — client-only: all depend on localStorage / drag / upload state -->
  <ClientOnly>
    <AppSettingsModal />
    <AppUploadOverlay />
    <AppLibraryPicker />
    <AppUploadToast />
    <AppToast />
    <AppDragGhost />
    <AppDragZoneOverlay />
    <AppDuplicateConflictModal />
    <AppCreateLibraryModal />
  </ClientOnly>
</template>
