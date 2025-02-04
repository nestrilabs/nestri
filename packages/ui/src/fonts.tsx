import { component$, Slot } from "@builder.io/qwik";

//font-sans or font-body
import "@fontsource/geist-sans/400.css"
import "@fontsource/geist-sans/500.css"
import "@fontsource/geist-sans/600.css"
import "@fontsource/geist-sans/700.css"
// font mono
import "@fontsource/geist-mono/400.css"
import "@fontsource/geist-mono/700.css"
//font-mona
import "@fontsource-variable/mona-sans"
//font-bricolage
import '@fontsource-variable/bricolage-grotesque';

export const Fonts = component$(() => {
  return <Slot />;
});