const CACHE = "sm-owner-shell-v7";
const SHARE_CACHE = "sm-owner-shared-v1";
const BASE = new URL("./", self.location).pathname;
const SHELL = [BASE, `${BASE}app.css?v=7`, `${BASE}app.js?v=7`, `${BASE}icon.svg`, `${BASE}manifest.webmanifest`];
self.addEventListener("install", event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL))));
self.addEventListener("activate", event => event.waitUntil(Promise.all([
  caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE && key !== SHARE_CACHE).map(key => caches.delete(key)))),
  self.clients.claim()
])));

async function receiveSharedContent(request) {
  const data = await request.formData();
  const file = data.getAll("files").find(item => item instanceof Blob && item.size > 0);
  if (!file) {
    const query = new URLSearchParams({
      recibir: "whatsapp",
      title: String(data.get("title") || ""),
      text: String(data.get("text") || ""),
      url: String(data.get("url") || "")
    });
    return Response.redirect(new URL(`?${query}`, self.registration.scope).href, 303);
  }

  if (file.size > 10 * 1024 * 1024) {
    return Response.redirect(new URL("?recibir=archivo-grande", self.registration.scope).href, 303);
  }

  const id = crypto.randomUUID();
  const sharedUrl = new URL(`__shared__/${id}`, self.registration.scope).href;
  const name = typeof file.name === "string" && file.name.trim() ? file.name.trim() : "actualizacion.smprop";
  const cache = await caches.open(SHARE_CACHE);
  await cache.put(sharedUrl, new Response(file, {
    headers: {
      "Content-Type": file.type || "application/octet-stream",
      "X-SM-File-Name": encodeURIComponent(name)
    }
  }));
  return Response.redirect(new URL(`?recibir=archivo&id=${encodeURIComponent(id)}`, self.registration.scope).href, 303);
}

self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  const shareAction = `${BASE}share-target`;
  const sharedPrefix = `${BASE}__shared__/`;

  if (event.request.method === "POST" && url.pathname === shareAction) {
    event.respondWith(receiveSharedContent(event.request));
    return;
  }

  if (url.pathname.startsWith(sharedPrefix)) {
    if (event.request.method === "GET") {
      event.respondWith(caches.open(SHARE_CACHE).then(cache => cache.match(event.request)).then(response => response || new Response("Archivo compartido no encontrado", { status: 404 })));
    } else if (event.request.method === "DELETE") {
      event.respondWith(caches.open(SHARE_CACHE).then(cache => cache.delete(event.request)).then(() => new Response(null, { status: 204 })));
    }
    return;
  }

  if (event.request.method !== "GET") return;
  if (url.pathname.startsWith("/api/")) return;
  event.respondWith(fetch(event.request).then(response => {
    const copy = response.clone();
    caches.open(CACHE).then(cache => cache.put(event.request, copy));
    return response;
  }).catch(() => caches.match(event.request).then(hit => hit || caches.match(BASE))));
});
