import colors from "tailwindcss/colors";
import tailwindcssAnimate from "tailwindcss-animate"
import defaultTheme from 'tailwindcss/defaultTheme'

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue,svg}',
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: "#FFEDE5",
          100: "#FFDBCC",
          200: "#FFB899",
          300: "#FF9466",
          400: "#FF7033",
          500: "#FF4F01",
          600: "#CC3D00",
          700: "#992E00",
          800: "#661F00",
          900: "#330F00",
          950: "#190800",
          DEFAULT: "#FF4F01"
        },
        secondary: colors.orange,
        accent: colors.amber,
        gray: {
          ...colors.neutral,
          925: "#111111",
        },
        danger: colors.red,
        warning: colors.yellow,
        success: colors.green,
        info: colors.blue,
      },
      fontFamily: {
        sans: ['geist-sans', 'geist-fallback', ...defaultTheme.fontFamily.sans],
        mono: ['geist-mono', 'geist-fallback', ...defaultTheme.fontFamily.mono],
        mona: ['github-mona', 'geist-fallback', ...defaultTheme.fontFamily.sans],
      },
    },
    plugins: [tailwindcssAnimate]
  }
}

