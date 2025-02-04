import { component$, Slot, useStyles$ } from "@builder.io/qwik";

// import SansNormal from "@fontsource/geist-sans/400.css?inline"
import "@fontsource/geist-sans/400.css"
import "@fontsource/geist-sans/500.css"
import "@fontsource/geist-sans/600.css"
import "@fontsource/geist-sans/700.css"
import "@fontsource/bricolage-grotesque/500.css"
import "@fontsource/bricolage-grotesque/600.css"
import "@fontsource/bricolage-grotesque/700.css"
import "@fontsource/bricolage-grotesque/800.css"
import "@fontsource/geist-mono/400.css"
import "@fontsource/geist-mono/700.css"
import styles from "./design/basement.css?inline"

export const Fonts = component$(() => {

  useStyles$(styles);

  return <Slot />;
});