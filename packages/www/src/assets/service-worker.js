const CACHE_NAME = 'image-cache-v1';
const AUTH_TOKEN = 'Bearer YOUR_DYNAMIC_AUTH_TOKEN'; // Replace at runtime if needed

self.addEventListener('install', (event) => {
    self.skipWaiting(); // Activate immediately
});

self.addEventListener('activate', (event) => {
    clients.claim(); // Take control of all clients
});

self.addEventListener('fetch', (event) => {
    const req = event.request;

    // Only intercept image requests
    if (req.destination !== 'image') return;

    // Only intercept our image requests
    const url = new URL(req.url);
    if (import.meta.env.VITE_CDN_URL !== url.origin || url.pathname.includes("/public")) return;

    event.respondWith(handleImageRequest(req));
});

async function handleImageRequest(request) {
    const cache = await caches.open(CACHE_NAME);

    const cachedResponse = await cache.match(request);
    if (cachedResponse) return cachedResponse;

    // Clone and modify the request with Authorization header
    const modifiedRequest = new Request(request.url, {
        method: request.method,
        headers: {
            ...Object.fromEntries(request.headers.entries()),
            Authorization: AUTH_TOKEN,
        },
        cache: 'no-store',
        mode: 'same-origin',
        credentials: 'same-origin',
    });

    try {
        const response = await fetch(modifiedRequest);

        if (response.ok) {
            await cache.put(request, response.clone());
        }

        return response;
    } catch (err) {
        return new Response('Image load failed', { status: 503 });
    }
}
