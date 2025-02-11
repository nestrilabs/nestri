import colors from "tailwindcss/colors";
import tailwindcssAnimate from "tailwindcss-animate"

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './{src,components,app}/**/*.{ts,tsx,html}',
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
        body: [
          "Geist Sans",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          "Inter",
          "Segoe UI",
          "Roboto",
          "sans-serif",
          "Apple Color Emoji",
          "Segoe UI Emoji",
          "Segoe UI Symbol",
          "Noto Color Emoji",
        ],
        mono: [
          "Geist Mono",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Monaco",
          "Consolas",
          "Liberation Mono",
          "Courier New",
          "monospace"
        ],
        mona: [
          "Mona Sans Variable",
          "-apple-system",
          "blinkmacsystemfont",
          "segoe ui",
          "roboto",
          "oxygen",
          "ubuntu",
          "cantarell",
          "fira",
          "sans",
          "droid sans",
          "helvetica neue",
          "sans-serif",
        ],
        bricolage: [
          "Bricolage Grotesque Variable",
          "-apple-system",
          "blinkmacsystemfont",
          "segoe ui",
          "roboto",
          "oxygen",
          "ubuntu",
          "cantarell",
          "fira",
          "sans",
          "droid sans",
          "helvetica neue",
          "sans-serif",
        ],
        basement: [
          "Basement Grotesque",
          "Bricolage Grotesque Variable",
          "-apple-system",
          "blinkmacsystemfont",
          "segoe ui",
          "roboto",
          "oxygen",
          "ubuntu",
          "cantarell",
          "fira",
          "sans",
          "droid sans",
          "helvetica neue",
          "sans-serif",
        ]
      },
      boxShadow: {
        "shadow-floating-light": "0px 6px 12px 0px rgba(99,99,99,.06),0px 22px 22px 0px rgba(99,99,99,.05),0px 50px 30px 0px rgba(99,99,99,.03),0px 89px 36px 0px rgba(99,99,99,.01),0px 140px 39px 0px rgba(99,99,99,0)",
        "inner-shadow-dark-float": "0px 1px 0px 0px hsla(0,0%,100%,.03) inset,0px 0px 0px 1px hsla(0,0%,100%,.03) inset,0px 0px 0px 1px rgba(0,0,0,.1),0px 2px 2px 0px rgba(0,0,0,.1),0px 4px 4px 0px rgba(0,0,0,.1),0px 8px 8px 0px rgba(0,0,0,.1)",
        "fullscreen": "0 0 0 1px rgba(0,0,0,.08),0px 1px 1px rgba(0,0,0,.02),0px 8px 16px -4px rgba(0,0,0,.04),0px 24px 32px -8px rgba(0,0,0,.06)",
        "menu": "0 0 0 1px rgba(0,0,0,.08),0px 1px 1px rgba(0,0,0,.02),0px 4px 8px -4px rgba(0,0,0,.04),0px 16px 24px -8px rgba(0,0,0,.06)",
      },
      keyframes: {
        "fade-up": {
          "0%": {
            opacity: "0",
            transform: "translateY(10px)",
          },
          "80%": {
            opacity: "0.7",
          },
          "100%": {
            opacity: "1",
            transform: "translateY(0px)",
          },
        },
        "fade-down": {
          "0%": {
            opacity: "0",
            transform: "translateY(-10px)",
          },
          "80%": {
            opacity: "0.6",
          },
          "100%": {
            opacity: "1",
            transform: "translateY(0px)",
          },
        },
        shake: {
          "25%": {
            translate: "0.25ch 0"
          },
          "75%": {
            translate: "-0.25ch 0"
          }
        },
        slide: {
          "100%": {
            translate: "var(--destination-x) var(--destination-y);",
          },
        },
        "multicolor": {
          "0%": {
            transform: "translateX(0%)"
          },
          "100%": {
            transform: "translateX(-50%)"
          }
        },
        "zoom-out": {
          "0%": {
            transform: "scale(1.2)"
          },
          "100%": {
            transform: "scale(1)"
          }
        },
        "fade-in": {
          " 0% ": {
            opacity: 0
          },
          "100%": {
            opacity: 1
          }
        }
      },
      animation: {
        // Fade up and down
        "fade-up": "fade-up 0.5s",
        "fade-down": "fade-down 0.5s",
        "shake": "shake 0.075s 8",
        "multicolor": "multicolor 5s linear 0s infinite",
        "zoom-out": "zoom-out 5s ease-out",
        "fade-in": "fade-in .3s ease forwards",
      },
    },
    plugins: [tailwindcssAnimate]
  }
}

