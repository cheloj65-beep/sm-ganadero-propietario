const CACHE = "sm-owner-shell-v11";
const SHARE_CACHE = "sm-owner-shared-v1";
const BASE = new URL("./", self.location).pathname;
const SHELL = [BASE, `${BASE}app.css?v=11`, `${BASE}app.js?v=11`, `${BASE}icon.svg`, `${BASE}manifest.webmanifest`];
self.addEventListener("message", event => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});
self.addEventListener("install", event => event.waitUntil(Promise.all([
  caches.open(CACHE).then(cache => cache.addAll(SHELL)),
  self.skipWaiting()
])));
self.addEventListener("activate", event => event.waitUntil(Promise.all([
  caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE && key !== SHARE_CACHE).map(key => caches.delete(key)))),
  self.clients.claim()
])));

async function receiveSharedContent(request) {
  let data;
  try {
    data = await request.formData();
  } catch {
    return sharedLanding("", "", "Android no pudo entregar el contenido del documento.");
  }

  const values = [];
  for (const [field, item] of data.entries()) {
    if (item && typeof item === "object" && typeof item.arrayBuffer === "function") values.push({ field, item });
  }
  const received = values.find(entry => entry.item.size > 0);
  const file = received?.item;
  if (!file) {
    const sharedText = [data.get("title"), data.get("text"), data.get("url")].filter(Boolean).join(" ");
    const query = new URLSearchParams(sharedText
      ? { recibir: "whatsapp", text: sharedText }
      : { recibir: "sin-archivo", campos: [...data.keys()].join(",") || "ninguno" });
    if (sharedText) return Response.redirect(new URL(`?${query}`, self.registration.scope).href, 303);
    return sharedLanding("", "", "WhatsApp abrió SM Propietario, pero no entregó el documento.");
  }

  if (file.size > 10 * 1024 * 1024) {
    return sharedLanding("", "", "El archivo supera el límite de 10 MB.");
  }

  const id = crypto.randomUUID();
  const sharedUrl = new URL(`__shared__/${id}`, self.registration.scope).href;
  const name = typeof file.name === "string" && file.name.trim() ? file.name.trim() : "actualizacion.smprop";
  const cache = await caches.open(SHARE_CACHE);
  const bytes = await file.arrayBuffer();
  await cache.put(sharedUrl, new Response(bytes, {
    headers: {
      "Content-Type": file.type || "application/octet-stream",
      "X-SM-File-Name": encodeURIComponent(name),
      "X-SM-Share-Field": encodeURIComponent(received.field || "files"),
      "X-SM-File-Size": String(file.size)
    }
  }));
  return sharedLanding(id, name);
}

function sharedLanding(id, name, error = "") {
  const target = id
    ? new URL(`?recibir=archivo&id=${encodeURIComponent(id)}`, self.registration.scope).href
    : new URL(`?recibir=entrega-invalida&detalle=${encodeURIComponent(error)}`, self.registration.scope).href;
  const safeName = String(name || "Documento SM").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character]);
  const safeError = String(error || "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character]);
  const title = error ? "No se pudo recibir el archivo" : "Documento recibido";
  const message = safeError || `${safeName} fue entregado correctamente a SM Propietario.`;
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#202c46"><title>${title}</title><style>body{margin:0;background:#eef3f8;color:#202c46;font-family:system-ui,-apple-system,sans-serif;display:grid;min-height:100vh;place-items:center}.card{width:min(86vw,430px);background:white;border-radius:24px;padding:30px;box-shadow:0 18px 50px #17233b26;text-align:center}.mark{width:72px;height:72px;border-radius:50%;display:grid;place-items:center;margin:0 auto 18px;background:${error ? "#fff0ec" : "#e8f6f0"};color:${error ? "#c64c3d" : "#08785d"};font-size:34px;font-weight:800}h1{font-size:23px;margin:0 0 10px}p{color:#58677b;line-height:1.45}.continue{display:block;text-decoration:none;border:0;border-radius:13px;padding:14px 20px;background:#e9695b;color:white;font-weight:750;font-size:16px;margin-top:14px}.wait{font-size:13px}</style></head><body><main class="card"><div class="mark">${error ? "!" : "SM"}</div><h1>${title}</h1><p>${message}</p><p class="wait">${error ? "Toca Continuar para ver la explicación." : "El documento ya está protegido temporalmente. Toca Continuar para abrirlo; esta pantalla no se cerrará sola."}</p><a class="continue" href="${target}">Continuar en SM Propietario</a></main></body></html>`;
  return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  const shareAction = `${BASE}share-target`;
  const sharedPrefix = `${BASE}__shared__/`;

  if (event.request.method === "POST" && url.pathname === shareAction) {
    event.respondWith(receiveSharedContent(event.request).catch(() => sharedLanding("", "", "Se produjo un error al recibir el documento desde WhatsApp.")));
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
