// https://github.com/nuxt-themes/docus/blob/main/nuxt.schema.ts
export default defineAppConfig({
  docus: {
    title: 'Nestri',
    description: 'An open-source, self-hosted Geforce Now alternative',
    image: 'https://feat-relay-hetzner.nestri.pages.dev/logo.webp',
    socials: {
      twitter: 'nestriness',
      github: 'nestriness/nestri',
      reddit: '/r/nestri',
      website: {
        label: 'Website',
        icon: 'lucide:house',
        href: 'https://nestri.io'
      }
    },
    github: {
      dir: 'apps/docs/content',
      branch: 'main',
      repo: 'nestri',
      owner: 'nestriness',
      edit: true
    },
    aside: {
      level: 0,
      collapsed: false,
      exclude: []
    },
    main: {
      padded: true,
      fluid: true
    },
    logo: "/nestri-logo.svg",
    header: {
      logo: true,
      showLinkIcon: true,
      exclude: [],
      fluid: true
    },
    footer: {
      credits: false,
    }
  }
})
