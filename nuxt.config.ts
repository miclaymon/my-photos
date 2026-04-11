// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-01-01',
  devtools: { enabled: true },

  modules: [
    '@nuxt/image',
    '@nuxtjs/tailwindcss',
    'nuxt-auth-utils',
  ],

  // @nuxt/image configuration
  image: {
    // Default image quality for optimization
    quality: 80,
    // Formats to generate (webp preferred, fallback to original)
    format: ['webp', 'jpeg', 'png'],
    // Screens for responsive srcset generation
    screens: {
      xs: 320,
      sm: 640,
      md: 768,
      lg: 1024,
      xl: 1280,
      xxl: 1536,
    },
  },

  // Server-side runtime config — all values are private (never sent to the browser).
  // Each key maps to an env var: NUXT_<SCREAMING_SNAKE> or the explicit env var below.
  runtimeConfig: {
    // Auth — overridden by NUXT_SESSION_PASSWORD
    session: {
      maxAge: 60 * 60 * 24 * 7, // 7 days
    },

    // Object storage (S3-compatible — RustFS by default)
    storageEndpoint: '',          // STORAGE_ENDPOINT
    storageAccessKeyId: '',       // STORAGE_ACCESS_KEY_ID
    storageSecretAccessKey: '',   // STORAGE_SECRET_ACCESS_KEY
    storageBucketName: 'photos',  // STORAGE_BUCKET_NAME
    storageRegion: 'us-east-1',   // STORAGE_REGION

    // Versioning: max photo versions to retain per object (0 = disabled)
    storageMaxVersions: 3,        // STORAGE_MAX_VERSIONS
  },

  typescript: {
    strict: true,
    typeCheck: false, // Enable in CI or on-demand; slows dev server
  },
})
