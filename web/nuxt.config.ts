// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-01-01',
  devtools: { enabled: true },

  // Inline script runs before first paint — prevents theme FOUC on reload.
  // Reads 'app-theme' from localStorage and sets data-theme on <html>
  // so the correct CSS variables are in place before any content renders.
  app: {
    head: {
      script: [
        {
          innerHTML: `(function(){try{var t=localStorage.getItem('app-theme')||'light';if(t==='system')t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';if(t!=='light')document.documentElement.setAttribute('data-theme',t);}catch(e){}})()`,
        },
      ],
    },
  },

  modules: [
    '@nuxt/image',
    '@nuxtjs/tailwindcss',
    'nuxt-auth-utils',
    ['@nuxt/fonts', {
      families: [
        { name: 'Instrument Sans', provider: 'google' },
        { name: 'Geist Mono', provider: 'google' },
      ],
      defaults: { weights: [400, 500, 600, 700] },
    }],
  ],

  css: ['~/assets/css/main.css'],

  // @nuxt/image configuration
  image: {
    quality: 80,
    format: ['webp', 'jpeg', 'png'],
    screens: {
      xs: 320,
      sm: 640,
      md: 768,
      lg: 1024,
      xl: 1280,
      xxl: 1536,
    },
    domains: ['localhost'],
  },

  // Server-side runtime config
  runtimeConfig: {
    session: {
      maxAge: 60 * 60 * 24 * 7,
    },
  },

  // Register all components by filename only, regardless of subdirectory
  components: {
    dirs: [{ path: '~/components', pathPrefix: false }],
  },

  // Enable View Transitions API for page navigations.
  // Album card covers use matching view-transition-name to animate into the
  // album detail page hero, giving a connected, native-app-style transition.
  experimental: {
    viewTransition: true,
  },

  typescript: {
    strict: true,
    typeCheck: false,
  },

})
