import { createTheme } from "@macaron-css/core";

const constants = {
    colorFadeDuration: "0.15s",
    borderRadius: "6px",
    textBoldWeight: "600",
    iconOpacity: "0.85",
    modalWidth: {
        sm: "480px",
        md: "640px",
        lg: "800px",
    },
    headerHeight: {
        root: "68px",
        stage: "52px",
    },
};

const formInput = {
    size: {
      base: "40px",
      sm: "32px",
    },
  };

const space = {
    px: "1px",
    0: "0px",
    0.5: "0.125rem",
    1: "0.25rem",
    1.5: "0.375rem",
    2: "0.5rem",
    2.5: "0.625rem",
    3: "0.75rem",
    3.5: "0.875rem",
    4: "1rem",
    5: "1.25rem",
    6: "1.5rem",
    7: "1.75rem",
    8: "2rem",
    9: "2.25rem",
    10: "2.5rem",
    11: "2.75rem",
    12: "3rem",
    14: "3.5rem",
    16: "4rem",
    20: "5rem",
    24: "6rem",
    28: "7rem",
    32: "8rem",
    36: "9rem",
    40: "10rem",
    44: "11rem",
    48: "12rem",
    52: "13rem",
    56: "14rem",
    60: "15rem",
    64: "16rem",
    72: "18rem",
    80: "20rem",
    96: "24rem",
};

const font = {
    lineHeight: "1.6",
    family: {
        heading: '"Mona Sans Variable", sans-serif',
        body: "'Geist Sans', sans-serif",
        code: '"Geist Mono Variable", monospace',
    },
    weight: {
        regular: "400",
        medium: "500",
        semibold: "600",
        bold: "700",
        extrabold: "800"
    },
    size: {
        mono_xs: "0.6875rem",
        xs: "0.75rem",
        mono_sm: "0.8125rem",
        sm: "0.875rem",
        mono_base: "0.9375rem",
        base: "1rem",
        mono_lg: "1.0625rem",
        lg: "1.125rem",
        mono_xl: "1.1875rem",
        xl: "1.25rem",
        mono_2xl: "1.375rem",
        "2xl": "1.5rem",
        "3xl": "1.875rem",
        "4xl": "2rem",
        "5xl": "3rem",
        "6xl": "3.75rem",
        "7xl": "4.5rem",
        "8xl": "6rem",
        "9xl": "8rem",
    },
};

const light = (() => {
    const gray = {
        d100: 'hsla(0,0%,95%)',
        d200: 'hsla(0,0%,92%)',
        d300: 'hsla(0,0%,90%)',
        d400: 'hsla(0,0%,82%)',
        d500: 'hsla(0,0%,79%)',
        d600: 'hsla(0,0%,66%)',
        d700: 'hsla(0,0%,56%)',
        d800: 'hsla(0,0%,49%)',
        d900: 'hsla(0,0%,40%)',
    };

    const blue = {
        d100: 'hsla(212,100%,97%)',
        d200: 'hsla(210,100%,96%)',
        d300: 'hsla(210,100%,94%)',
        d400: 'hsla(209,100%,90%)',
        d500: 'hsla(209,100%,80%)',
        d600: 'hsla(208,100%,66%)',
        d700: 'hsla(212,100%,48%)',
        d800: 'hsla(212,100%,41%)',
        d900: 'hsla(211,100%,42%)',
    };

    const red = {
        d100: "hsla(0,100%,97%)",
        d200: "hsla(0,100%,96%)",
        d300: "hsla(0,100%,95%)",
        d400: "hsla(0,90%,92%)",
        d500: "hsla(0,82%,85%)",
        d600: "hsla(359,90%,71%)",
        d700: "hsla(358,75%,59%)",
        d800: "hsla(358,70%,52%)",
        d900: "hsla(358,66%,48%)",
    };
    const amber = {
        d100: "hsla(39,100%,95%)",
        d200: "hsla(44,100%,92%)",
        d300: "hsla( 43,96%,90%)",
        d400: "hsla(42,100%,78%)",
        d500: "hsla(38,100%,71%)",
        d600: "hsla( 36,90%,62%)",
        d700: "hsla(39,100%,57%)",
        d800: "hsla(35,100%,52%)",
        d900: "hsla(30,100%,32%)",
    };
    const green = {
        d100: "hsla(120,60%,96%)",
        d200: "hsla(120,60%,95%)",
        d300: "hsla(120,60%,91%)",
        d400: "hsla(122,60%,86%)",
        d500: "hsla(124,60%,75%)",
        d600: "hsla(125,60%,64%)",
        d700: "hsla(131,41%,46%)",
        d800: "hsla(132,43%,39%)",
        d900: "hsla(133,50%,32%)",
    };
    const teal = {
        d100: "hsla(169,70%,96%)",
        d200: "hsla(167,70%,94%)",
        d300: "hsla(168,70%,90%)",
        d400: "hsla(170,70%,85%)",
        d500: "hsla(170,70%,72%)",
        d600: "hsla(170,70%,57%)",
        d700: "hsla(173,80%,36%)",
        d800: "hsla(173,83%,30%)",
        d900: "hsla(174,91%,25%)",
    };

    const purple = {
        d100: "hsla(276,100%,97%)",
        d200: "hsla(277,87%,97%)",
        d300: "hsla(274,78%,95%)",
        d400: "hsla(276,71%,92%)",
        d500: "hsla(274,70%,82%)",
        d600: "hsla(273,72%,73%)",
        d700: "hsla(272,51%,54%)",
        d800: "hsla(272,47%,45%)",
        d900: "hsla(274,71%,43%)",
    };

    const pink = {
        d100: "hsla(330,100%,96%)",
        d200: "hsla(340,90%,96%)",
        d300: "hsla(340,82%,94%)",
        d400: "hsla(341,76%,91%)",
        d500: "hsla(340,75%,84%)",
        d600: "hsla(341,75%,73%)",
        d700: "hsla(336,80%,58%)",
        d800: "hsla(336,74%,51%)",
        d900: "hsla(336,65%,45%)",
    };

    const grayAlpha = {
        d100: "rgba(0,0,0,0.05)",
        d200: "hsla(0,0%,0%,0.08)",
        d300: "hsla(0,0%,0%,0.1)",
        d400: "hsla(0,0%,0%,0.08)",
        d500: "hsla(0,0%,0%,0.21)",
        d600: "hsla(0,0%,0%,0.34)",
        d700: "hsla(0,0%,0%,0.44)",
        d800: "hsla(0,0%,0%,0.51)",
        d900: "hsla(0,0%,0%,0.61)",
    };

    const d1000 = {
        gray: 'hsla(0,0%,9%)',
        blue: 'hsla(211,100%,15%)',
        red: "hsla(355,49%,15%)",
        amber: "hsla(20,79%,17%)",
        green: "hsla(128,29%,15%)",
        teal: "hsla(171,80%,13%)",
        purple: "hsla(276,100%,15)",
        pink: "hsla(333,74%,15%)",
        grayAlpha: " hsla(0,0%,0%,0.91)",
    }
    const brand = "#FF4F01"

    const background = {
        d100: 'rgba(255,255,255,0.8)',
        d200: '#f4f5f6',
    };

    const headerGradient = "linear-gradient(rgba(66, 144, 243, 0.2) 0%, rgba(206, 127, 243, 0.1) 52.58%, rgba(248, 236, 215, 0) 100%)"

    const contrastFg = '#ffffff';
    const focusBorder = `0 0 0 1px ${grayAlpha.d600}, 0px 0px 0px 4px rgba(0,0,0,0.16)`;
    const focusColor = blue.d700
    const hoverColor = "hsl(0,0%,22%)"

    const text = {
        primary: {
            base: d1000.gray,
            surface: gray.d900,
        },
        info: {
            base: d1000.amber,
            surface: amber.d900,
        },
        danger: {
            base: d1000.red,
            surface: red.d900,
        },
    };

    return {
        gray,
        blue,
        red,
        amber,
        green,
        teal,
        purple,
        pink,
        grayAlpha,
        background,
        contrastFg,
        focusBorder,
        focusColor,
        d1000,
        brand,
        text,
        headerGradient,
        hoverColor
    };
})()

const dark = (() => {
    const gray = {
        d100: "hsla(0,0%,10%)",
        d200: "hsla(0,0%,12%)",
        d300: "hsla(0,0%,16%)",
        d400: "hsla(0,0%,18%)",
        d500: "hsla(0,0%,27%)",
        d600: "hsla(0,0%,53%)",
        d700: "hsla(0,0%,56%)",
        d800: "hsla(0,0%,49%)",
        d900: "hsla(0,0%,63%)",
    };

    const blue = {
        d100: "hsla(216,50%,12%)",
        d200: "hsla(214,59%,15%)",
        d300: "hsla(213,71%,20%)",
        d400: "hsla(212,78%,23%)",
        d500: "hsla(211,86%,27%)",
        d600: "hsla(206,100%,50%)",
        d700: "hsla(212,100%,48%)",
        d800: "hsla(212,100%,41%)",
        d900: "hsla(210,100%,66%)",
    };

    const red = {
        d200: "hsla(357,46%,16%)",
        d100: "hsla(357,37%,12%)",
        d300: "hsla(356,54%,22%)",
        d400: "hsla(357,55%,26%)",
        d500: "hsla(357,60%,32%)",
        d600: "hsla(358,75%,59%)",
        d700: "hsla(358,75%,59%)",
        d800: "hsla(358,69%,52%)",
        d900: "hsla(358,100%,69%)",
    };
    const amber = {
        d100: "hsla(35,100%,8%)",
        d200: "hsla(32,100%,10%)",
        d300: "hsla(33,100%,15%)",
        d400: "hsla(35,100%,17%)",
        d500: "hsla(35,91%,22%)",
        d600: "hsla(39,85%,49%)",
        d700: "hsla(39,100%,57%)",
        d800: "hsla(35,100%,52%)",
        d900: "hsla(39,90%,50%)",
    };
    const green = {
        d100: "hsla(136,50%,9%)",
        d200: "hsla(137,50%,12%)",
        d300: "hsla(136,50%,14%)",
        d400: "hsla(135,70%,16%)",
        d500: "hsla(135,70%,23%)",
        d600: "hsla(135,70%,34%)",
        d700: "hsla(131,41%,46%)",
        d800: "hsla(132,43%,39%)",
        d900: "hsla(131,43%,57%)",
    };
    const teal = {
        d100: "hsla(169,78%,7%)",
        d200: "hsla(170,74%,9%)",
        d300: "hsla(171,75%,13%)",
        d400: "hsla(171,85%,13%)",
        d500: "hsla(172,85%,20%)",
        d600: "hsla(172,85%,32%)",
        d700: "hsla(173,80%,36%)",
        d800: "hsla(173,83%,30%)",
        d900: "hsla(174,90%,41%)",
    };
    const purple = {
        d100: "hsla(283,30%,12%)",
        d200: "hsla(281,38%,16%)",
        d300: "hsla(279,44%,23%)",
        d400: "hsla(277,46%,28%)",
        d500: "hsla(274,49%,35%)",
        d600: "hsla(272,51%,54%)",
        d700: "hsla(272,51%,54%)",
        d800: "hsla(272,47%,45%)",
        d900: "hsla(275,80%,71%)",
    };
    const pink = {
        d100: "hsla(335,32%,12%)",
        d200: "hsla(335,43%,16%)",
        d300: "hsla(335,47%,21%)",
        d400: "hsla(335,51%,22%)",
        d500: "hsla(335,57%,27%)",
        d600: "hsla(336,75%,40%)",
        d700: "hsla(336,80%,58%)",
        d800: "hsla(336,74%,51%)",
        d900: "hsla(341,90%,67%)",
    };

    const grayAlpha = {
        d100: "rgba(255,255,255,0.06)",
        d200: "hsla(0,0%,100%,0.09)",
        d300: "hsla(0,0%,100%,0.13)",
        d400: "hsla(0,0%,100%,0.14)",
        d500: "hsla(0,0%,100%,0.24)",
        d600: "hsla(0,0%,100%,0.51)",
        d700: "hsla(0,0%,100%,0.54)",
        d800: "hsla(0,0%,100%,0.47)",
        d900: "hsla(0,0%,100%,0.61)",
    };

    const d1000 = {
        gray: 'hsla(0,0%,93%)',
        blue: 'hsla( 206,100%,96%)',
        red: "hsla( 353,90%,96%)",
        amber: "hsla( 40,94%,93%))",
        green: "hsla(136,73%,94%)",
        teal: "hsla(166,71%,93%)",
        purple: "hsla(281,73%,96%)",
        pink: "hsla( 333,90%,96%)",
        grayAlpha: "hsla(0,0%,100%,0.92)",
    }

    const brand = "#FF4F01"

    const background = {
        d100: "rgba(255,255,255,0.04)",
        d200: 'rgb(19,21,23)',
    };

    const contrastFg = '#ffffff';
    const focusBorder = `0 0 0 1px ${grayAlpha.d600}, 0px 0px 0px 4px rgba(255,255,255,0.24)`;
    const focusColor = blue.d900
    const hoverColor = "hsl(0,0%,80%)"
    const headerGradient = "linear-gradient(rgba(66, 144, 243, 0.2) 0%, rgba(239, 148, 225, 0.1) 50%, rgba(191, 124, 7, 0) 100%)"

    const text = {
        primary: {
            base: d1000.gray,
            surface: gray.d900,
        },
        info: {
            base: d1000.amber,
            surface: amber.d900,
        },
        danger: {
            base: d1000.red,
            surface: red.d900,
        },
    };

    return {
        gray,
        blue,
        red,
        amber,
        green,
        teal,
        purple,
        pink,
        grayAlpha,
        background,
        contrastFg,
        focusBorder,
        focusColor,
        d1000,
        text,
        brand,
        headerGradient,
        hoverColor
    };
})()

export const [lightClass, theme] = createTheme({
    ...constants,
    space,
    font,
    color: light,
    input: formInput
});

export const darkClass = createTheme(theme, {
    ...theme,
    ...constants,
    space,
    font,
    color: dark,
    input: formInput
});