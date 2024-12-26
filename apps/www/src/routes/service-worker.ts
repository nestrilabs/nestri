/*
 * WHAT IS THIS FILE?
 *
 * The service-worker.ts file is used to have state of the art prefetching.
 * https://qwik.dev/qwikcity/prefetching/overview/
 *
 * Qwik uses a service worker to speed up your site and reduce latency, ie, not used in the traditional way of offline.
 * You can also use this file to add more functionality that runs in the service worker.
 */
import { setupServiceWorker } from "@builder.io/qwik-city/service-worker";

setupServiceWorker();

const IMAGE_CACHE_NAME = 'image-cache-v1';

// Install event: Open a cache
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(IMAGE_CACHE_NAME)
  );
});

addEventListener("activate", () => self.clients.claim());

self.addEventListener('fetch', (event) => {
  if (event.request.destination === 'image') {
    event.respondWith(
      caches.open(IMAGE_CACHE_NAME).then((cache) => {
        return cache.match(event.request).then((response) => {
          if (response) {
            // If image is in cache, return it
            return response;
          }

          // If not in cache, fetch from network, cache it, then return
          return fetch(event.request).then((networkResponse) => {
            cache.put(event.request, networkResponse.clone());
            return networkResponse;
          });
        });
      })
    );
  }
});

// Add a message event listener
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'CACHE_IMAGES') {
    event.waitUntil(
      caches.open(IMAGE_CACHE_NAME).then((cache) => {
        return Promise.all(event.data.urls.map((url: RequestInfo | URL) =>
          cache.add(url).catch(error => console.error('Failed to cache:', url, error))
        ));
      })
    );
  }
});

declare const self: ServiceWorkerGlobalScope;
