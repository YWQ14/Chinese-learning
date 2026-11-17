const CACHE_NAME = "ktv-app-offline-v2";

// Core app files & external CDN scripts cached for 100% offline use
const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./manifest.json",
  "https://cdn.jsdelivr.net/npm/pinyin-pro@3.19.6/dist/index.js",
  "https://cdn.jsdelivr.net/npm/opencc-js@1.0.5/dist/umd/full.js",
  "https://cdn.tailwindcss.com"
];

// 1. INSTALL: Pre-cache core shell and CDN libraries
self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await Promise.allSettled(
        PRECACHE_URLS.map(async (url) => {
          try {
            const isCrossOrigin = url.startsWith("http");
            const req = new Request(url, isCrossOrigin ? { mode: "cors" } : {});
            const res = await fetch(req);
            if (res.ok || res.type === "opaque") {
              await cache.put(url, res);
            }
          } catch (err) {
            // Fallback to no-cors for opaque CDN scripts (such as cdn.tailwindcss.com)
            try {
              const opaqueRes = await fetch(new Request(url, { mode: "no-cors" }));
              await cache.put(url, opaqueRes);
            } catch (innerErr) {
              console.warn("[SW] Could not pre-cache:", url, innerErr);
            }
          }
        })
      );
    })
  );
});

// 2. ACTIVATE: Clean up older caches and take control immediately
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      )
    ).then(() => self.clients.claim())
  );
});

// 3. FETCH: Network-first for live APIs; Offline-first (Cache-First) for app shell & CDN libraries
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const requestUrl = new URL(event.request.url);

  // Live API lookups (translation / LRCLIB / YouTube & Spotify oEmbed):
  // Always try network first with exact query parameters, fallback to exact cache match if offline
  const isLiveApi =
    requestUrl.hostname.includes("googleapis.com") ||
    requestUrl.hostname.includes("mymemory.translated.net") ||
    requestUrl.hostname.includes("lrclib.net") ||
    requestUrl.hostname.includes("youtube.com") ||
    requestUrl.hostname.includes("youtu.be") ||
    requestUrl.hostname.includes("spotify.com");

  if (isLiveApi) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
    return;
  }

  // Only ignore query strings (?...) when matching local app shell files (e.g. ./index.html)
  const isSameOrigin = requestUrl.origin === self.location.origin;

  // Offline-first (Cache-First) for local HTML/manifest & CDN scripts
  event.respondWith(
    caches.match(event.request, { ignoreSearch: isSameOrigin }).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(event.request)
        .then((networkResponse) => {
          if (
            networkResponse &&
            (networkResponse.status === 200 || networkResponse.type === "opaque")
          ) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          // If navigation fails offline, always return cached ./index.html
          if (event.request.mode === "navigate") {
            return caches.match("./index.html") || caches.match("./");
          }
        });
    })
  );
});
