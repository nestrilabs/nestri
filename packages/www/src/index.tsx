/* @refresh reload */
import { render } from "solid-js/web";
// import posthog from "posthog-js";
// posthog.init("phc_M0b2lW4smpsGIufiTBZ22USKwCy0fyqljMOGufJc79p", {
//   api_host: "https://telemetry.ion.sst.dev",
// });

import "modern-normalize/modern-normalize.css";
import { App } from "./App";
import { StorageProvider } from "./providers/account";

const root = document.getElementById("root");

if (import.meta.env.DEV && !(root instanceof HTMLElement)) {
  throw new Error(
    "Root element not found. Did you forget to add it to your index.html? Or maybe the id attribute got mispelled?"
  );
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/src/assets/service-worker.js')
      .then((reg) => {
        console.log('[SW] Registered:', reg.scope);
      })
      .catch((err) => {
        console.error('[SW] Registration failed:', err);
      });
  });
}

render(
  () => (
    <StorageProvider>
      <App />
    </StorageProvider>
  ),
  root!
);