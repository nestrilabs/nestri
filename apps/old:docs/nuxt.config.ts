export default defineNuxtConfig({
  // https://github.com/nuxt-themes/docus
  extends: ['@nuxt-themes/docus'],
  components: true,


  devtools: { enabled: true },

  modules: [// Remove it if you don't use Plausible analytics
  // https://github.com/nuxt-modules/plausible
  '@nuxtjs/plausible', '@nuxt/ui'],

  compatibilityDate: '2024-09-29'
})