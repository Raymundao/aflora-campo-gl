// SW do protótipo GL. App: rede-primeiro (pega update na hora). Tiles/fontes: cache.
const CACHE = "aflora-gl-v2";
const TILES = "aflora-gl-tiles-v1";
const ASSETS = [
  "./", "./index.html", "./manifest.webmanifest",
  "./css/estilo.css", "./js/app.js",
  "./vendor/maplibre-gl.js", "./vendor/maplibre-gl.css",
  "./icons/icon.svg", "./icons/icon-192.png", "./icons/icon-512.png",
];
const ehTileOuFonte = (u) => /arcgisonline|mts?\d?\.google|googleapis|openmaptiles\.org/.test(u);

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k !== CACHE && k !== TILES).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = e.request.url;
  if (ehTileOuFonte(url)) {
    e.respondWith((async () => {
      const tc = await caches.open(TILES);
      const hit = await tc.match(e.request);
      if (hit) return hit;
      try { const r = await fetch(e.request); if (r && (r.ok || r.type === "opaque")) tc.put(e.request, r.clone()); return r; }
      catch (err) { return hit || Response.error(); }
    })());
    return;
  }
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const mesma = new URL(url).origin === self.location.origin;
    try {
      const r = await Promise.race([
        fetch(e.request, mesma ? { cache: "no-store" } : undefined),
        new Promise((_, rej) => setTimeout(() => rej(new Error("t")), 3000)),
      ]);
      if (r && r.status === 200 && r.type === "basic") cache.put(e.request, r.clone());
      return r;
    } catch (err) { return (await cache.match(e.request)) || cache.match("./index.html"); }
  })());
});
