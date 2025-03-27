export default defineAppConfig({
  shadcnDocs: {
    site: {
      name: 'Nestri Docs',
      description: 'Beautifully designed Nuxt Content template built with shadcn-vue. Customizable. Compatible. Open Source.',
    },
    theme: {
      customizable: false,
      color: 'orange',
      radius: 0.5,
    },
    header: {
      title: 'Nestri Docs',
      showTitle: true,
      darkModeToggle: true,
      logo: {
        light: '/logo.png',
        dark: '/logo-dark.svg',
      },
      nav: [{
        title: 'Star on GitHub',
        icon: 'lucide:star',
        to: 'https://github.com/nestrilabs/nestri',
        target: '_blank',
      }, {
        title: 'Create Issues',
        icon: 'lucide:circle-dot',
        to: 'https://github.com/nestrilabs/nestri/issues',
        target: '_blank',
      }],
      links: [
      {
        icon: 'lucide:github',
        to: 'https://github.com/nestrilabs/nestri',
        target: '_blank',
      }],
    },
    aside: {
      useLevel: true,
      collapse: false,
    },
    main: {
      breadCrumb: true,
      showTitle: true,
    },
    footer: {
      credits: 'Copyright © 2025',
      links: [{
        icon: 'lucide:github',
        to: 'https://github.com/nestrilabs/nestri',
        target: '_blank',
      },
      {
        icon: 'ri:discord-line',
        to: 'https://discord.com/invite/Y6etn3qKZ3',
        target: '_blank',
      }],
    },
    toc: {
      enable: true,
      title: 'On This Page',
      links: [{
        title: 'Star on GitHub',
        icon: 'lucide:star',
        to: 'https://github.com/nestrilabs/nestri',
        target: '_blank',
      }, {
        title: 'Create Issues',
        icon: 'lucide:circle-dot',
        to: 'https://github.com/nestrilabs/nestri/issues',
        target: '_blank',
      }],
    },
    search: {
      enable: true,
      inAside: false,
    }
  }
});