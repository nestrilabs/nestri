import { component$ } from "@builder.io/qwik";
import {
  QwikCityProvider,
  RouterOutlet,
  ServiceWorkerRegister,
} from "@builder.io/qwik-city";
import { RouterHead } from "@nestri/ui";
import { isDev } from "@builder.io/qwik/build";
import { QwikPartytown } from './components/partytown/partytown';

import "@nestri/ui/globals.css";
import { Fonts } from "@nestri/ui";

export default component$(() => {
  /**
   * The root of a QwikCity site always start with the <QwikCityProvider> component,
   * immediately followed by the document's <head> and <body>.
   *
   * Don't remove the `<head>` and `<body>` elements.
   */

  return (
    <Fonts>
      <QwikCityProvider>
        <head>
          <QwikPartytown />
          <meta name="theme-color" media="(prefers-color-scheme: light)" content="#f5f5f5" />
          <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#171717" />
          <meta charset="utf-8" />
          <link
            rel="preload"
            href="/fonts/BasementGrotesque-Black.woff2"
            as="font"
            crossOrigin=""
          />
          <link
            rel="preload"
            href="/fonts/BasementGrotesque-Black.woff"
            as="font"
            crossOrigin=""
          />
          {!isDev && (
            <link
              rel="manifest"
              href={`${import.meta.env.BASE_URL}manifest.json`}
            />
          )}
          <RouterHead />
        </head>
        <body
          class="bg-gray-100 text-gray-950 dark:bg-gray-900 dark:text-gray-50 font-body flex flex-col items-center justify-center overflow-x-hidden antialiased"
          lang="en">
          <RouterOutlet />
          {!isDev && <ServiceWorkerRegister />}
          {/* <ServiceWorkerRegister />  */}
        </body>
      </QwikCityProvider>
    </Fonts>
  );
});
