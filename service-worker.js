const CACHE = "sm-owner-shell-v23-whatsapp";
const SHARE_CACHE = "sm-owner-shared-v1";
let shareQueue = Promise.resolve();
const BASE = new URL("./", self.location).pathname;
const SHELL = [BASE, `${BASE}app.css?v=23`, `${BASE}field.css?v=2`, `${BASE}app.js?v=23`, `${BASE}field.js?v=21`, `${BASE}icon.svg`, `${BASE}brahman-opening-v2.png`, `${BASE}manifest.webmanifest`];
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

async function notifyShared(id = "") {
  try {
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of clients) if (client.url.startsWith(self.registration.scope)) client.postMessage({ type: "SM_SHARED_RECEIVED", id });
  } catch { /* The durable inbox is also checked on reopening/focus. */ }
}

async function shareFailure(message) {
  try {
    const cache = await caches.open(SHARE_CACHE);
    await cache.put(new URL("__share_notice__", self.registration.scope).href, new Response(message, { headers: { "Content-Type": "text/plain;charset=utf-8" } }));
    await notifyShared();
  } catch { /* The landing still explains the failure if storage is unavailable. */ }
  return sharedLanding("", "", message);
}

async function receiveSharedContent(request) {
  let data;
  try {
    data = await request.formData();
  } catch {
    return shareFailure("Android no pudo entregar el contenido del documento. Tus consultas no cambiaron.");
  }

  const values = [];
  for (const [field, item] of data.entries()) {
    if (item && typeof item === "object" && typeof item.arrayBuffer === "function") values.push({ field, item });
  }
  if (values.filter(entry => entry.item.size > 0).length > 1) return shareFailure("Comparte un solo documento SM a la vez. No se importó ningún archivo.");
  let received = values.find(entry => entry.item.size > 0);
  let file = received?.item;
  if (!file) {
    const sharedText = [data.get("title"), data.get("text"), data.get("url")].filter(item => typeof item === "string").join(" ");
    const token = sharedText.match(/CGP1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/)?.[0];
    if (!token || token.length > 65536) return shareFailure("WhatsApp abrió SM Ganadero, pero entregó solo texto, el nombre o un archivo vacío. No llegó el contenido y no se actualizaron tus datos. En WhatsApp espera a que el documento termine de descargarse, mantén presionado su mensaje (sin abrirlo), toca Compartir y elige SM Ganadero.");
    file = new File([token], "vinculacion.smpair", { type: "text/plain" });
    received = { field: "text", item: file };
  }

  if (file.size > 10 * 1024 * 1024) {
    return shareFailure("El archivo supera el límite de 10 MB. No se importó ni se cambiaron tus consultas.");
  }

  const id = crypto.randomUUID();
  const sharedUrl = new URL(`__shared__/${id}`, self.registration.scope).href;
  const name = typeof file.name === "string" && file.name.trim() ? file.name.trim() : "actualizacion.smprop";
  const cache = await caches.open(SHARE_CACHE);
  const pending = (await cache.keys()).filter(key => new URL(key.url).pathname.startsWith(`${BASE}__shared__/`));
  if (pending.length >= 10) return shareFailure("Hay 10 documentos pendientes en SM Ganadero. Revisa o descarta uno dentro de la app y vuelve a compartir. Los documentos anteriores siguen conservados.");
  const bytes = await file.arrayBuffer();
  await cache.put(sharedUrl, new Response(bytes, {
    headers: {
      "Content-Type": file.type || "application/octet-stream",
      "X-SM-File-Name": encodeURIComponent(name),
      "X-SM-Share-Field": encodeURIComponent(received.field || "files"),
      "X-SM-File-Size": String(file.size),
      "X-SM-Received-At": new Date().toISOString()
    }
  }));
  await cache.delete(new URL("__share_notice__", self.registration.scope).href);
  await notifyShared(id);
  return sharedLanding(id, name);
}

function sharedLanding(id, name, error = "") {
  const target = id
    ? new URL(`?recibir=archivo&id=${encodeURIComponent(id)}`, self.registration.scope).href
    : new URL(`?recibir=entrega-invalida&detalle=${encodeURIComponent(error)}`, self.registration.scope).href;
  const safeName = String(name || "Documento SM").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character]);
  const safeError = String(error || "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character]);
  const title = error ? "No se pudo recibir el archivo" : "Documento recibido";
  const message = safeError || `${safeName} fue entregado correctamente a SM Ganadero.`;
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#202c46"><title>${title}</title><style>body{margin:0;background:#eef3f8;color:#202c46;font-family:system-ui,-apple-system,sans-serif;display:grid;min-height:100vh;place-items:center}.card{width:min(86vw,430px);background:white;border-radius:24px;padding:30px;box-shadow:0 18px 50px #17233b26;text-align:center}.mark{width:72px;height:72px;border-radius:50%;display:grid;place-items:center;margin:0 auto 18px;background:${error ? "#fff0ec" : "#e8f6f0"};color:${error ? "#c64c3d" : "#08785d"};font-size:34px;font-weight:800}h1{font-size:23px;margin:0 0 10px}p{color:#58677b;line-height:1.45}.continue{display:block;text-decoration:none;border:0;border-radius:13px;padding:14px 20px;background:#e9695b;color:white;font-weight:750;font-size:16px;margin-top:14px}.wait{font-size:13px}</style></head><body><main class="card"><div class="mark">${error ? "!" : "SM"}</div><h1>${title}</h1><p>${message}</p><p class="wait">${error ? "Toca Continuar para ver la explicación." : "El documento ya está protegido temporalmente. Toca Continuar para abrirlo; esta pantalla no se cerrará sola."}</p><a class="continue" href="${target}">Continuar en SM Ganadero</a></main></body></html>`;
  return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  const shareAction = `${BASE}share-target`;
  const sharedPrefix = `${BASE}__shared__/`;

  if (event.request.method === "POST" && url.pathname === shareAction) {
    const delivery = shareQueue.then(() => receiveSharedContent(event.request)).catch(() => shareFailure("No se pudo conservar el documento recibido. Tus consultas no cambiaron. Deja el documento en WhatsApp y vuelve a compartir cuando haya espacio disponible."));
    shareQueue = delivery.then(() => undefined, () => undefined);
    event.respondWith(delivery);
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
