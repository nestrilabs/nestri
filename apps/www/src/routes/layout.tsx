import posthog from "posthog-js";
import Nestri from "@nestri/sdk";
import { NavProgress } from "@nestri/ui";
import { component$, Slot, useVisibleTask$ } from "@builder.io/qwik";
import { type DocumentHead, type RequestHandler } from "@builder.io/qwik-city";

export const onGet: RequestHandler = async ({ cacheControl }) => {
  // Control caching for this request for best performance and to reduce hosting costs:
  // https://qwik.dev/docs/caching/
  cacheControl({
    // Always serve a cached response by default, up to a week stale
    staleWhileRevalidate: 60 * 60 * 24 * 7,
    // Max once every 5 seconds, revalidate on the server to get a fresh version of this page
    maxAge: 5,
  });
};

export const onRequest: RequestHandler = async ({ cookie, url, redirect, sharedMap }) => {
  const access = cookie.get("access_token")
  if (access) {
    try {

      const bearerToken = access.value

      const nestriClient = new Nestri({
        bearerToken,
        baseURL: "https://api.nestri.io"
      })
      const currentProfile = await nestriClient.users.retrieve()
      sharedMap.set("profile", currentProfile.data)
    } catch (error) {
      console.log("error working with bearer token", error)
      // cookie.delete("access_token")
      // cookie.delete("refresh_token")

      // throw redirect(302, url.origin)
    }
  }
}

export default component$(() => {
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(() => {
    posthog.init('phc_EN9hs9bPxPrTn6224XjPG55t7w9Rh9lMBacDSEHiZjP', { api_host: 'https://app.posthog.com' })
  })
  return (
    <>
      <NavProgress />
      <Slot />
    </>
  );
});

export const head: DocumentHead = {
  title: 'Nestri – Your games. Your rules.',
  meta: [
    {
      name: 'description',
      content: 'Nestri – Your games. Your rules.',
    },
    {
      name: "og:title",
      content: "Nestri – Your games. Your rules.",
    },
    {
      name: "og:description",
      content: "Play games with friends right from your browser.",
    },
    {
      name: "twitter:title",
      content: "Nestri – Your games. Your rules.",
    },
    {
      name: "twitter:description",
      content: "Play games with friends right from your browser.",
    },
    {
      name: "twitter:card",
      content: "summary_large_image",
    },
  ],
};
