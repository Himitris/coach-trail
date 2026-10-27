/* Service worker de Coach Trail : coquille de l'appli disponible hors ligne.
   - pages (navigation) : réseau d'abord, repli sur la dernière copie d'index.html ;
   - /assets/* (fichiers versionnés) : cache d'abord ;
   - /api/layout : seule donnée mise en cache (lecture, réponses 200), pour afficher la
     disposition hors ligne. Aucune autre réponse d'API n'est conservée ; jamais d'écriture. */
const VERSION = "v1";
const SHELL = `shell-${VERSION}`;
const ASSETS = `assets-${VERSION}`;
const DATA = `data-${VERSION}`;
const KEEP = [SHELL, ASSETS, DATA];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((cache) => cache.add("/")).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => !KEEP.includes(n)).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

async function put(name, request, response) {
  if (response.ok) {
    const cache = await caches.open(name);
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => put(SHELL, "/", response))
        .catch(() => caches.match("/").then((cached) => cached ?? Response.error())),
    );
  } else if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.match(request).then((cached) => cached ?? fetch(request).then((r) => put(ASSETS, request, r))),
    );
  } else if (url.pathname === "/api/layout") {
    event.respondWith(
      fetch(request)
        .then((response) => put(DATA, request, response))
        .catch(() => caches.match(request).then((cached) => cached ?? Response.error())),
    );
  }
});
