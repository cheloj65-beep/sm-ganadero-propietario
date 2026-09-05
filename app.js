"use strict";

const PRODUCT = Object.freeze({
  name: "SM Ganadero",
  ownerName: "SM Ganadero · Campo",
  pairingContract: "sm-owner-pairing.v1",
  syncContract: "sm-owner-sync.v1",
  storageKey: "sm-owner-mobile.v1",
  deviceDatabase: "sm-owner-device.v1"
});

const OPENING_MESSAGES = Object.freeze([
  ["Todo lo puedo en Cristo que me fortalece.", "Filipenses 4:13"],
  ["El Señor es mi pastor; nada me faltará.", "Salmo 23:1"],
  ["Encomienda al Señor tus obras, y tus pensamientos serán afirmados.", "Proverbios 16:3"],
  ["Esfuérzate y sé valiente; no temas ni desmayes.", "Josué 1:9"],
  ["Los que esperan en el Señor renovarán sus fuerzas.", "Isaías 40:31"],
  ["Todo tiene su tiempo, y todo lo que se quiere debajo del cielo tiene su hora.", "Eclesiastés 3:1"],
  ["La bendición del Señor es la que enriquece.", "Proverbios 10:22"],
  ["Fiel es el que prometió.", "Hebreos 10:23"]
]);

const state = { pairingToken: "", pairing: null, snapshots: [], activeFarm: "", activeModule: "", metric: "births", installPrompt: null, pendingSnapshot: null, pendingSnapshots: [] };
const el = id => document.getElementById(id);
const fmt = new Intl.NumberFormat("es-BO", { maximumFractionDigits: 0 });
const fmt1 = new Intl.NumberFormat("es-BO", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmt2 = new Intl.NumberFormat("es-BO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = value => `Bs ${fmt.format(Number(value || 0))}`;
const money2 = value => `Bs ${fmt2.format(Number(value || 0))}`;
const h = value => String(value ?? "").replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);

function fromBase64Url(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(value.length + ((4 - value.length % 4) % 4), "=");
  const binary = atob(base64);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

function toBase64Url(value) {
  let binary = "";
  for (const byte of new Uint8Array(value)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function concatBytes(left, right) {
  const result = new Uint8Array(left.length + right.length);
  result.set(left, 0); result.set(right, left.length);
  return result;
}

function equalBytes(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left[index] ^ right[index];
  return difference === 0;
}

function compactGuid(value) { return String(value || "").replace(/[{}-]/g, "").toLowerCase(); }

function dotnetRoundtrip(value) {
  const text = String(value || "");
  const match = text.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,7}))?Z$/i);
  return match ? `${match[1]}.${(match[2] || "").padEnd(7, "0")}Z` : text;
}

function openDeviceDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(PRODUCT.deviceDatabase, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("identity");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("No se pudo proteger la identidad de este teléfono."));
  });
}

async function readDeviceIdentity() {
  const database = await openDeviceDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction("identity", "readonly");
    const request = transaction.objectStore("identity").get("current");
    request.onsuccess = () => { database.close(); resolve(request.result || null); };
    request.onerror = () => { database.close(); reject(new Error("No se pudo leer la identidad protegida del teléfono.")); };
  });
}

async function saveDeviceIdentity(identity) {
  const database = await openDeviceDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction("identity", "readwrite");
    transaction.objectStore("identity").put(identity, "current");
    transaction.oncomplete = () => { database.close(); resolve(); };
    transaction.onerror = () => { database.close(); reject(new Error("No se pudo guardar la identidad protegida del teléfono.")); };
  });
}

async function getOrCreateDeviceIdentity() {
  const existing = await readDeviceIdentity();
  if (existing?.deviceId && existing?.privateKey && existing?.publicKeySpki) return existing;
  const generated = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const publicKeySpki = toBase64Url(await crypto.subtle.exportKey("spki", generated.publicKey));
  const privatePkcs8 = await crypto.subtle.exportKey("pkcs8", generated.privateKey);
  const privateKey = await crypto.subtle.importKey("pkcs8", privatePkcs8, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  new Uint8Array(privatePkcs8).fill(0);
  const identity = { deviceId: crypto.randomUUID(), privateKey, publicKeySpki };
  await saveDeviceIdentity(identity);
  return identity;
}

async function clearDeviceIdentity() {
  await new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(PRODUCT.deviceDatabase);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(new Error("No se pudo borrar la identidad del teléfono."));
    request.onblocked = () => resolve();
  });
}

async function parsePairingToken(token, enforceExpiry = true) {
  const parts = token.trim().split(".");
  if (parts.length !== 3 || parts[0] !== "CGP1") throw new Error("El código de emparejamiento no tiene un formato válido.");
  const payloadBytes = fromBase64Url(parts[1]);
  const suppliedChecksum = fromBase64Url(parts[2]);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", payloadBytes));
  if (!equalBytes(suppliedChecksum, digest.slice(0, 10))) throw new Error("El código fue alterado o está incompleto.");
  const payload = JSON.parse(new TextDecoder().decode(payloadBytes));
  if (payload.contractVersion !== PRODUCT.pairingContract || !payload.pairingId || fromBase64Url(payload.secret).length !== 32)
    throw new Error("El código no contiene un emparejamiento válido.");
  if (enforceExpiry && new Date(payload.expiresAtUtc).getTime() < Date.now()) throw new Error("El código venció. Solicita uno nuevo al veterinario.");
  return payload;
}

async function decryptEnvelope(envelope, pairing) {
  if (envelope.contractVersion !== PRODUCT.syncContract || compactGuid(envelope.pairingId) !== compactGuid(pairing.pairingId))
    throw new Error("La actualización pertenece a otra clave de propietario.");
  if (!pairing.farms.some(farm => farm.toLocaleLowerCase("es") === envelope.farm.toLocaleLowerCase("es")))
    throw new Error("La propiedad no está autorizada para este celular.");
  if (new Date(envelope.expiresAtUtc).getTime() < Date.now()) throw new Error("La actualización disponible venció.");
  if (new Date(envelope.createdAtUtc).getTime() > Date.now() + 24 * 60 * 60 * 1000) throw new Error("La fecha de la actualización no es válida.");
  const associated = `${PRODUCT.syncContract}|${compactGuid(envelope.pairingId)}|${envelope.sequence}|${envelope.farm}|${dotnetRoundtrip(envelope.createdAtUtc)}|${dotnetRoundtrip(envelope.expiresAtUtc)}`;
  const encrypted = concatBytes(fromBase64Url(envelope.ciphertext), fromBase64Url(envelope.authenticationTag));
  const key = await crypto.subtle.importKey("raw", fromBase64Url(pairing.secret), "AES-GCM", false, ["decrypt"]);
  try {
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64Url(envelope.nonce), additionalData: new TextEncoder().encode(associated), tagLength: 128 }, key, encrypted);
    const snapshot = JSON.parse(new TextDecoder().decode(plaintext));
    if (snapshot.contractVersion !== "sm-owner-dashboard.v1" || snapshot.farm !== envelope.farm || !snapshot.summary || !Array.isArray(snapshot.monthlyTrend)) throw new Error();
    return { ...snapshot, sequence: envelope.sequence };
  } catch {
    throw new Error("La actualización fue alterada o no corresponde a este celular.");
  }
}

function savedConfiguration() {
  try { return JSON.parse(localStorage.getItem(PRODUCT.storageKey) || "null"); }
  catch { return null; }
}

function saveConfiguration(token) {
  localStorage.setItem(PRODUCT.storageKey, JSON.stringify({ token, snapshots: state.snapshots, activeFarm: state.activeFarm, activeModule: state.activeModule }));
}

function showPairing(message = "") {
  el("pairingView").classList.remove("hidden"); el("dashboardView").classList.add("hidden"); el("bottomNav").classList.add("hidden");
  el("pairingError").textContent = message;
}

function showDashboard() {
  el("pairingView").classList.add("hidden"); el("dashboardView").classList.remove("hidden"); el("bottomNav").classList.remove("hidden");
  el("dashboardView").classList.remove("brand-enter");
  requestAnimationFrame(() => el("dashboardView").classList.add("brand-enter"));
  window.setTimeout(() => window.SMGField?.refresh(), 0);
}

function setBusy(busy) {
  el("pairingView").classList.toggle("busy", busy); el("pairButton").disabled = busy; el("syncButton").classList.toggle("loading", busy);
}

function showToast(message) {
  el("toast").textContent = message; el("toast").classList.remove("hidden");
  window.clearTimeout(showToast.timer); showToast.timer = window.setTimeout(() => el("toast").classList.add("hidden"), 3200);
}

function extractPairingToken(value) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  const match = normalized.match(/CGP1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
  return match ? match[0] : "";
}

async function pastePairingFromClipboard() {
  el("pairingError").textContent = "";
  try {
    const received = await navigator.clipboard.readText();
    const token = extractPairingToken(received);
    if (!token) throw new Error("No se encontró un código SM válido. Copia primero el mensaje largo de WhatsApp.");
    el("pairingTokenInput").value = token;
    showToast("Código pegado. Ahora toca Preparar este celular");
  } catch (error) {
    el("pairingError").textContent = error?.name === "NotAllowedError"
      ? "Android no permitió pegar automáticamente. Mantén presionado el cuadro del código y toca Pegar."
      : (error.message || "No se pudo leer el código copiado.");
    el("pairingTokenInput").focus();
  }
}

function receiveSharedPairingFromUrl() {
  const params = new URLSearchParams(location.search);
  const token = extractPairingToken([params.get("text"), params.get("title"), params.get("url")].filter(Boolean).join(" "));
  if (!token) return;
  el("pairingTokenInput").value = token;
  el("pairingError").textContent = "Código recibido desde WhatsApp. Toca Preparar este celular.";
  history.replaceState(null, "", location.pathname);
}

async function receiveSharedFileFromUrl() {
  const params = new URLSearchParams(location.search);
  const receiveMode = params.get("recibir");
  const id = params.get("id");
  if (receiveMode === "archivo-grande") {
    showToast("El archivo recibido supera el límite de 10 MB.");
    history.replaceState(null, "", location.pathname);
    return true;
  }
  if (receiveMode === "sin-archivo" || receiveMode === "entrega-invalida") {
    const detail = params.get("detalle");
    const message = detail || "WhatsApp abrió SM Ganadero, pero el teléfono no entregó el contenido del documento. Vuelve a WhatsApp, mantén presionado el archivo, toca Compartir y elige SM Ganadero.";
    if (!state.pairing) showPairing(message);
    else window.alert(message);
    history.replaceState(null, "", location.pathname);
    return true;
  }
  if (receiveMode !== "archivo" || !id) return false;

  const sharedUrl = `./__shared__/${encodeURIComponent(id)}`;
  try {
    const response = await fetch(sharedUrl, { cache: "no-store" });
    if (!response.ok) throw new Error("Android no pudo entregar el documento. Compártelo nuevamente desde WhatsApp.");
    const encodedName = response.headers.get("X-SM-File-Name") || "actualizacion.smprop";
    let fileName = "actualizacion.smprop";
    try { fileName = decodeURIComponent(encodedName); } catch { fileName = encodedName; }
    const blob = await response.blob();
    const text = await blob.text();
    const lowerName = fileName.toLocaleLowerCase("es");
    const pairingToken = extractPairingToken(text);

    if (lowerName.endsWith(".smpair") || pairingToken) {
      if (!pairingToken) throw new Error("El archivo .smpair está incompleto o no es válido.");
      el("pairingTokenInput").value = pairingToken;
      el("pairingFileName").textContent = fileName;
      if (!state.pairing) {
        await pairDevice();
      } else {
        showPairing("Archivo recibido desde WhatsApp. Revisa y toca Preparar este celular para reemplazar la vinculación actual.");
      }
    } else {
      const updateFile = new File([blob], (lowerName.endsWith(".smprop") || lowerName.endsWith(".smvet")) ? fileName : "actualizacion.smprop", { type: blob.type || "application/json" });
      await importOwnerUpdate(updateFile);
    }
  } catch (error) {
    if (!state.pairing) showPairing(error.message || "No se pudo leer el documento recibido.");
    else showToast(error.message || "No se pudo leer el documento recibido.");
  } finally {
    fetch(sharedUrl, { method: "DELETE" }).catch(() => {});
    history.replaceState(null, "", location.pathname);
  }
  return true;
}

async function pairDevice() {
  setBusy(true); el("pairingError").textContent = "";
  try {
    const token = el("pairingTokenInput").value.trim();
    const pairing = await parsePairingToken(token);
    state.pairingToken = token; state.pairing = pairing; state.activeFarm = pairing.farms[0] || "";
    await getOrCreateDeviceIdentity();
    saveConfiguration(token);
    showDashboard(); renderEmptyDashboard(); showToast(`Todo listo. Importa la primera actualización ${isVeterinarian() ? ".smvet" : ".smprop"}`);
  } catch (error) { showPairing(error.message || "No se pudo vincular este celular."); }
  finally { setBusy(false); }
}

async function importOwnerUpdate(file) {
  try {
    if (!state.pairing) throw new Error("Primero prepara este celular con el archivo .smpair.");
    const lowerName = file?.name?.toLocaleLowerCase("es") || "";
    if (!file || (!lowerName.endsWith(".smprop") && !lowerName.endsWith(".smvet"))) throw new Error("Selecciona una actualización .smprop o .smvet.");
    if (Number(file.size || 0) <= 0) throw new Error("El archivo recibido está vacío. No se dañaron tus datos: vuelve a descargarlo desde WhatsApp o solicita que lo envíen nuevamente como documento.");
    const rawText = (await file.text()).replace(/^\uFEFF/, "").trim();
    if (!rawText) throw new Error("Android entregó un documento vacío. Descárgalo nuevamente desde WhatsApp antes de importarlo.");
    if (!rawText.startsWith("{") || !rawText.endsWith("}")) throw new Error(`El documento llegó incompleto (${file.size} bytes). Vuelve a descargarlo o pide que lo envíen otra vez como documento .smprop.`);
    let document;
    try { document = JSON.parse(rawText); }
    catch { throw new Error(`El documento no terminó de descargarse correctamente (${file.size} bytes). Elimínalo del celular, descárgalo nuevamente desde WhatsApp y vuelve a intentar.`); }
    const envelopes = document?.contractVersion === "sm-veterinarian-sync.v1" && Array.isArray(document.updates) ? document.updates : [document];
    if (!envelopes.length || envelopes.some(envelope => !envelope || envelope.contractVersion !== PRODUCT.syncContract || !envelope.pairingId || !envelope.ciphertext || !envelope.authenticationTag))
      throw new Error("El archivo no es una actualización válida de SM Ganadero o está incompleto.");
    const snapshots = [];
    for (const envelope of envelopes) {
      const snapshot = await decryptEnvelope(envelope, state.pairing);
      const current = state.snapshots.find(row => row.farm.toLocaleLowerCase("es") === snapshot.farm.toLocaleLowerCase("es"));
      if (!current || Number(current.sequence || 0) < Number(snapshot.sequence || 0)) snapshots.push(snapshot);
    }
    if (!snapshots.length) throw new Error("Esta actualización ya fue importada o es anterior a la guardada.");
    state.pendingSnapshots = snapshots; state.pendingSnapshot = snapshots[0];
    showUpdatePreview(snapshots[0], snapshots.length);
  } catch (error) {
    const message = error?.message || "No se pudo abrir la actualización.";
    window.alert(message);
    showToast("No se importó el documento. Revisa el mensaje mostrado.");
  } finally { el("updateFileInput").value = ""; }
}

function showUpdatePreview(snapshot, total = 1) {
  const summary = snapshot.summary || {};
  el("previewContent").innerHTML = `<div class="preview-farm"><strong>${total > 1 ? `${total} propiedades del veterinario` : h(snapshot.farm)}</strong><span>${total > 1 ? `Incluye: ${state.pendingSnapshots.map(item => h(item.farm)).join(", ")}` : `${h(snapshot.ownerName || "Propietario")} · ${h(snapshot.municipality || "")}`}</span></div><div class="preview-grid"><div><small>Preparada</small><b>${h(latestText(snapshot.generatedAtUtc))}</b></div><div><small>Primera propiedad</small><b>${h(snapshot.farm)}</b></div><div><small>Animales</small><b>${fmt.format(summary.activeAnimals || 0)}</b></div><div><small>Acceso</small><b>${h(state.pairing?.accessMode || "Propietario")}</b></div></div><p>Al confirmar se actualizarán únicamente las propiedades incluidas en este archivo.</p>`;
  el("previewError").textContent = "";
  el("updatePreview").classList.remove("hidden");
}

function confirmOwnerUpdate() {
  const updates = state.pendingSnapshots.length ? state.pendingSnapshots : (state.pendingSnapshot ? [state.pendingSnapshot] : []); if (!updates.length) return;
  for (const snapshot of updates) { state.snapshots = state.snapshots.filter(row => row.farm.toLocaleLowerCase("es") !== snapshot.farm.toLocaleLowerCase("es")); state.snapshots.push(snapshot); }
  state.activeFarm = updates[0].farm; state.activeModule = ""; state.pendingSnapshot = null; state.pendingSnapshots = [];
  saveConfiguration(state.pairingToken); el("updatePreview").classList.add("hidden"); showDashboard(); render(); setOffline(false); showToast("La información de esta propiedad está al día");
}

function renderEmptyDashboard() {
  el("farmTitle").textContent = state.activeFarm || "Propiedad";
  el("updatedText").textContent = "Celular preparado · sin datos todavía";
  el("heroMessage").textContent = "Todo listo. Importa el archivo enviado por el veterinario para ver la información de tu propiedad.";
  el("heroStatus").classList.add("warning"); el("heroStatus").querySelector("span").textContent = `Importa una actualización ${isVeterinarian() ? ".smvet" : ".smprop"}`;
  el("kpiGrid").innerHTML = [kpi("Animales activos", "—", "esperando actualización", "coral"), kpi("Nacimientos", "—", "esperando actualización", "good"), kpi("Ventas netas", "—", "esperando actualización"), kpi("Resultado operativo", "—", "esperando actualización", "navy")].join("");
  el("alertsList").innerHTML = `<div class="panel empty">Toca + para importar el archivo recibido por WhatsApp.</div>`; el("alertCount").textContent = "0 avisos";
  el("chart").innerHTML = ""; el("managementGrid").innerHTML = ""; el("managementKpis").innerHTML = ""; el("paddockList").innerHTML = `<div class="panel empty">Sin información todavía</div>`; el("categoryList").innerHTML = `<div class="empty">Sin información todavía</div>`; el("workList").innerHTML = `<div class="panel empty">Sin información todavía</div>`;
  el("pairingInfo").textContent = `${state.pairing.ownerName} · ${state.pairing.farms.join(", ")} · ${isVeterinarian() ? "registro de campo habilitado" : "consulta únicamente"}`;
  window.SMGField?.refresh();
}

function activeSnapshot() { return state.snapshots.find(snapshot => snapshot.farm === state.activeFarm) || state.snapshots[0]; }
function isVeterinarian() { return String(state.pairing?.accessMode || "").toLocaleLowerCase("es").includes("veterinario"); }
function pct(value) { return Math.max(0, Math.min(100, Number(value || 0))); }
function latestText(value) { return new Date(value).toLocaleString("es-BO", { dateStyle: "short", timeStyle: "short" }); }

function render() {
  if (!state.snapshots.length) return;
  renderFarmSwitcher();
  const aggregate = state.activeFarm === "__all__" && isVeterinarian();
  const snapshot = aggregate ? buildVeterinarianOverview() : activeSnapshot(); if (!snapshot) return;
  if (!aggregate) state.activeFarm = snapshot.farm;
  renderModuleSwitcher(snapshot, aggregate);
  const moduleView = !aggregate && state.activeModule ? (snapshot.moduleViews || []).find(row => row.module === state.activeModule) : null;
  if (state.activeModule && !moduleView) state.activeModule = "";
  const view = moduleView ? moduleSnapshot(snapshot, moduleView) : snapshot;
  const summary = view.summary;
  const critical = view.alerts.filter(row => row.severity === "Crítica" || row.severity === "Atención").length;
  const females = view.monthlyTrend.reduce((sum, row) => sum + row.femaleBirths, 0);
  const males = view.monthlyTrend.reduce((sum, row) => sum + row.maleBirths, 0);
  const propertyIdentity = aggregate ? `${state.snapshots.length} propiedades habilitadas` : [snapshot.ownerName, snapshot.municipality].filter(Boolean).join(" · ");
  el("farmTitle").textContent = aggregate ? "Todas las propiedades" : `${snapshot.farm}${moduleView ? ` · ${moduleView.module}` : ""}`;
  el("updatedText").textContent = `${propertyIdentity ? `${propertyIdentity} · ` : ""}Actualizado ${latestText(snapshot.dataUpdatedAtUtc)}`;
  el("heroEyebrow").textContent = aggregate || isVeterinarian() ? "Panel del veterinario" : "Panel del propietario";
  el("heroTitle").textContent = aggregate ? "Toda tu gestión, en un vistazo" : moduleView ? `${moduleView.module} en ${snapshot.farm}` : "Tu propiedad, clara de un vistazo";
  el("heroMessage").textContent = aggregate ? "Vista consolidada de las propiedades que administra el veterinario." : moduleView ? `Indicadores exclusivos del módulo ${moduleView.module}; los costos generales permanecen en el resumen de la propiedad.` : "Información productiva y económica consolidada para acompañar cada decisión.";
  el("heroStatus").classList.toggle("warning", critical > 0); el("heroStatus").querySelector("span").textContent = critical ? `${critical} temas requieren atención` : "Sin alertas prioritarias";
  el("kpiGrid").innerHTML = [
    kpi(aggregate ? "Propiedades" : "Animales activos", aggregate ? fmt.format(state.snapshots.length) : fmt.format(summary.activeAnimals), aggregate ? "gestión consolidada" : "existencia actual", "coral"),
    kpi(`Nacimientos ${new Date(snapshot.referenceDate).getFullYear()}`, fmt.format(summary.birthsYear), `${females} hembras · ${males} machos`, "good", "positive"),
    kpi("Ventas netas", money(summary.netSalesYearBs), `${summary.soldAnimalsYear} animales vendidos`),
    moduleView?.biotechnology ? kpi("Embriones viables", fmt.format(moduleView.biotechnology.viableEmbryos), `${fmt1.format(moduleView.biotechnology.viabilityRate * 100)} % de viabilidad`, "navy", "positive") : moduleView ? kpi("Trabajos recientes", fmt.format(view.recentWork.length), `en ${moduleView.module}`, "navy") : kpi("Resultado operativo", money(summary.operatingResultYearBs), `Costo: ${money2(summary.costPerProducedKgBs)}/kg`, "navy", summary.operatingResultYearBs < 0 ? "negative" : "positive")
  ].join("");
  renderAlerts(view.alerts); renderChart(view, Boolean(moduleView)); renderManagement(summary, Boolean(moduleView), moduleView?.biotechnology); renderPaddocks(view.paddocks); renderCategories(view.categories); renderWork(view.recentWork);
  el("pairingInfo").textContent = `${state.pairing.ownerName} · ${isVeterinarian() ? `Veterinario · ${state.pairing.farms.length} propiedades · registro de campo` : `${state.pairing.farms.join(", ")} · consulta únicamente`}`;
  saveConfiguration(state.pairingToken);
  window.SMGField?.refresh();
}

function kpi(label, value, caption, tone = "", valueClass = "") {
  return `<article class="kpi ${tone}"><div class="label">${h(label)}</div><div class="value ${valueClass}">${h(value)}</div><div class="caption">${h(caption)}</div></article>`;
}

function renderFarmSwitcher() {
  const switcher = el("propertySwitcher"), select = el("farmSelect");
  switcher.classList.toggle("hidden", state.snapshots.length < 2 && !isVeterinarian());
  const all = isVeterinarian() && state.snapshots.length > 1 ? `<option value="__all__" ${state.activeFarm === "__all__" ? "selected" : ""}>Todas las propiedades</option>` : "";
  select.innerHTML = all + state.snapshots.map(row => `<option value="${h(row.farm)}" ${row.farm === state.activeFarm ? "selected" : ""}>${h(row.farm)}</option>`).join("");
}

function renderModuleSwitcher(snapshot, aggregate) {
  const switcher = el("moduleSwitcher"), select = el("moduleSelect");
  const modules = aggregate ? [] : (snapshot.productionModules || []).filter(Boolean);
  switcher.classList.toggle("hidden", modules.length < 2);
  select.innerHTML = `<option value="">Resumen general</option>` + modules.map(module => `<option value="${h(module)}" ${module === state.activeModule ? "selected" : ""}>${h(module)}</option>`).join("");
  if (aggregate || modules.length < 2) state.activeModule = "";
}

function moduleSnapshot(snapshot, moduleView) {
  const summary = { ...snapshot.summary, activeAnimals: moduleView.activeAnimals, birthsYear: moduleView.birthsYear, weaningsYear: moduleView.weaningsYear, deathsYear: moduleView.deathsYear, soldAnimalsYear: moduleView.soldAnimalsYear, netSalesYearBs: moduleView.netSalesYearBs, pregnant: moduleView.pregnant, empty: moduleView.empty, abortions: moduleView.abortions, pregnancyRate: moduleView.pregnancyRate, totalCostsYearBs: 0, operatingResultYearBs: 0, producedKgYear: 0, costPerProducedKgBs: 0, rainfallYearMm: 0 };
  return { ...snapshot, summary, monthlyTrend: moduleView.monthlyTrend || [], categories: moduleView.categories || [], recentWork: moduleView.recentWork || [], biotechnology: moduleView.biotechnology || null };
}

function buildVeterinarianOverview() {
  const snapshots = state.snapshots;
  const sum = key => snapshots.reduce((total, row) => total + Number(row.summary?.[key] || 0), 0);
  const diagnosed = sum("pregnant") + sum("empty") + sum("abortions");
  const produced = sum("producedKgYear"), costs = sum("totalCostsYearBs");
  const summary = { activeAnimals: sum("activeAnimals"), birthsYear: sum("birthsYear"), weaningsYear: sum("weaningsYear"), deathsYear: sum("deathsYear"), soldAnimalsYear: sum("soldAnimalsYear"), netSalesYearBs: sum("netSalesYearBs"), totalCostsYearBs: costs, operatingResultYearBs: sum("operatingResultYearBs"), producedKgYear: produced, costPerProducedKgBs: produced > 0 ? costs / produced : 0, rainfallYearMm: sum("rainfallYearMm"), pregnant: sum("pregnant"), empty: sum("empty"), abortions: sum("abortions"), pregnancyRate: diagnosed > 0 ? sum("pregnant") / diagnosed : 0 };
  const monthlyTrend = Array.from({ length: 12 }, (_, index) => {
    const rows = snapshots.map(row => row.monthlyTrend?.[index]).filter(Boolean); const total = key => rows.reduce((value, row) => value + Number(row[key] || 0), 0);
    return { month: rows[0]?.month || new Date(new Date().getFullYear(), index, 1).toISOString(), monthName: rows[0]?.monthName || String(index + 1), births: total("births"), femaleBirths: total("femaleBirths"), maleBirths: total("maleBirths"), weanings: total("weanings"), deaths: total("deaths"), soldAnimals: total("soldAnimals"), netSalesBs: total("netSalesBs"), expensesBs: total("expensesBs"), rainfallMm: total("rainfallMm") };
  });
  const categoryMap = new Map();
  snapshots.flatMap(snapshot => snapshot.categories || []).forEach(row => { const old = categoryMap.get(row.category) || { category: row.category, heads: 0, liveWeightKg: 0 }; old.heads += Number(row.heads || 0); old.liveWeightKg += Number(row.liveWeightKg || 0); categoryMap.set(row.category, old); });
  const categories = [...categoryMap.values()].map(row => ({ ...row, averageWeightKg: row.heads ? row.liveWeightKg / row.heads : 0 })).sort((a, b) => b.heads - a.heads);
  const alerts = snapshots.flatMap(snapshot => (snapshot.alerts || []).map(row => ({ ...row, title: `${snapshot.farm}: ${row.title}` })));
  const recentWork = snapshots.flatMap(snapshot => (snapshot.recentWork || []).map(row => ({ ...row, farm: snapshot.farm }))).sort((a, b) => new Date(b.date) - new Date(a.date));
  const paddocks = snapshots.flatMap(snapshot => (snapshot.paddocks || []).map(row => ({ ...row, paddock: `${snapshot.farm} · ${row.paddock}` })));
  return { farm: "Todas las propiedades", referenceDate: snapshots[0].referenceDate, dataUpdatedAtUtc: snapshots.map(row => row.dataUpdatedAtUtc).sort().at(-1), summary, monthlyTrend, categories, paddocks, alerts, recentWork };
}

function renderAlerts(rows) {
  el("alertCount").textContent = `${rows.length} avisos`;
  el("alertsList").innerHTML = rows.length ? rows.slice(0, 6).map(row => {
    const css = row.severity === "Crítica" ? "critical" : row.severity === "Correcto" ? "correct" : "";
    return `<article class="alert ${css}"><i class="alert-line"></i><div><strong>${h(row.title)}</strong><p>${h(row.detail)}</p></div><span class="tag">${h(row.area)}</span></article>`;
  }).join("") : `<div class="panel empty">Todo en orden · sin alertas prioritarias</div>`;
}

const metricDefinition = {
  births: { value: row => row.births, text: value => fmt.format(value) },
  sales: { value: row => row.netSalesBs, text: value => money(value) },
  costs: { value: row => row.expensesBs, text: value => money(value) },
  rain: { value: row => row.rainfallMm, text: value => `${fmt.format(value)} mm` }
};

function renderChart(snapshot, moduleOnly = false) {
  el("metricTabs").querySelectorAll("button").forEach(button => { button.disabled = moduleOnly && (button.dataset.metric === "costs" || button.dataset.metric === "rain"); button.classList.toggle("metric-hidden", button.disabled); });
  if (moduleOnly && (state.metric === "costs" || state.metric === "rain")) state.metric = "births";
  const definition = metricDefinition[state.metric];
  const maximum = Math.max(0, ...snapshot.monthlyTrend.map(definition.value));
  el("chart").className = `chart ${state.metric}`;
  el("chart").innerHTML = snapshot.monthlyTrend.map(row => {
    const value = definition.value(row); const height = maximum <= 0 ? 5 : Math.max(5, value / maximum * 100);
    return `<div class="bar-column"><button class="bar" type="button" style="height:${height.toFixed(2)}%" aria-label="${h(row.monthName)}: ${h(definition.text(value))}"><span>${h(definition.text(value))}</span></button><div class="month">${h(row.monthName.slice(0, 3))}</div></div>`;
  }).join("");
  el("metricTabs").querySelectorAll("button").forEach(button => button.classList.toggle("active", button.dataset.metric === state.metric));
}

function renderManagement(summary, moduleOnly = false, biotechnology = null) {
  if (biotechnology) {
    el("managementGrid").innerHTML = `
      <article class="panel repro-card"><div class="ring" style="--rate:${pct(biotechnology.viabilityRate * 100)}"><div><strong>${fmt1.format(biotechnology.viabilityRate * 100)} %</strong><small>viabilidad</small></div></div><div class="repro-copy"><h3>Biotecnología reproductiva</h3><p>Resultado acumulado de OPU/FIV y superovulación/TE.</p><div class="mini-stats"><div class="mini-stat"><b>${fmt.format(biotechnology.sessions)}</b><span>Sesiones</span></div><div class="mini-stat"><b>${fmt.format(biotechnology.recovered)}</b><span>Recuperados</span></div><div class="mini-stat"><b>${fmt.format(biotechnology.viableEmbryos)}</b><span>Viables</span></div></div></div></article>
      <article class="panel"><div class="label">Transferencia embrionaria</div><h3>${fmt.format(biotechnology.pregnancies)} preñeces confirmadas</h3><p>${fmt.format(biotechnology.transferredEmbryos)} embriones transferidos · ${fmt1.format(biotechnology.pregnancyRate * 100)} % de preñez diagnosticada.</p><div class="result-line"><span>Costo por embrión viable</span><b>${money2(biotechnology.costPerViableEmbryoBs)}</b></div></article>`;
    el("managementKpis").innerHTML = [
      kpi("Costo de sesiones", money(biotechnology.totalCostBs), "laboratorio, honorarios y productos"),
      kpi("Embriones viables", fmt.format(biotechnology.viableEmbryos), "resultado acumulado", "good")
    ].join("");
    return;
  }
  const economicMaximum = Math.max(1, summary.netSalesYearBs, summary.totalCostsYearBs);
  const resultClass = summary.operatingResultYearBs < 0 ? "negative" : "positive";
  el("managementGrid").innerHTML = `
    <article class="panel repro-card"><div class="ring" style="--rate:${pct(summary.pregnancyRate * 100)}"><div><strong>${fmt1.format(summary.pregnancyRate * 100)} %</strong><small>preñez</small></div></div><div class="repro-copy"><h3>Resultado reproductivo</h3><p>Último diagnóstico válido por matriz.</p><div class="mini-stats"><div class="mini-stat"><b>${summary.pregnant}</b><span>Preñadas</span></div><div class="mini-stat"><b>${summary.empty}</b><span>Vacías</span></div><div class="mini-stat"><b>${summary.abortions}</b><span>Abortos</span></div></div></div></article>
    ${moduleOnly ? `<article class="panel module-note"><div class="label">Lectura económica del módulo</div><h3>${money(summary.netSalesYearBs)} en ventas</h3><p>Los costos no se dividen automáticamente entre módulos. Revísalos en <strong>Resumen general</strong> para evitar cálculos engañosos.</p></article>` : `<article class="panel"><div class="label">Balance económico acumulado</div><div class="economic-row"><span>Ventas</span><div class="track"><div class="fill sales-fill" style="width:${pct(summary.netSalesYearBs / economicMaximum * 100)}%"></div></div><b>${money(summary.netSalesYearBs)}</b></div><div class="economic-row"><span>Producción</span><div class="track"><div class="fill cost-fill" style="width:${pct(summary.totalCostsYearBs / economicMaximum * 100)}%"></div></div><b>${money(summary.totalCostsYearBs)}</b></div><div class="result-line"><span>Resultado operativo</span><b class="${resultClass}">${money(summary.operatingResultYearBs)}</b></div><p class="balance-note">También considera compras, comercialización y variación de inventario.</p></article>`}`;
  el("managementKpis").innerHTML = moduleOnly ? [kpi("Destetes", fmt.format(summary.weaningsYear), "en el módulo", "good"), kpi("Mortalidad", fmt.format(summary.deathsYear), "bajas registradas", "navy", summary.deathsYear > 0 ? "negative" : "positive")].join("") : [kpi("Lluvia", `${fmt.format(summary.rainfallYearMm)} mm`, "acumulado anual"), kpi("Producción", `${fmt.format(summary.producedKgYear)} kg`, "balance de peso vivo", "coral"), kpi("Destetes", fmt.format(summary.weaningsYear), "en la gestión", "good"), kpi("Mortalidad", fmt.format(summary.deathsYear), "bajas registradas", "navy", summary.deathsYear > 0 ? "negative" : "positive")].join("");
}

function renderPaddocks(rows) {
  el("paddockList").innerHTML = rows.length ? rows.slice(0, 8).map(row => {
    const status = row.capacityStatus === "Sobrecargado" ? "danger" : row.capacityStatus === "Atención" ? "warning" : "";
    return `<article class="paddock"><div class="paddock-top"><strong class="paddock-name">${h(row.paddock)}</strong><span class="capacity ${status}">${h(row.capacityStatus)}</span></div><div class="track"><div class="fill" style="width:${pct(row.capacityUsePercent)}%"></div></div><div class="paddock-meta"><span>${fmt.format(row.currentAnimals)} animales · ${fmt1.format(row.areaHa)} ha</span><span>máx. ${fmt.format(row.estimatedMaximumAnimals)} · ${fmt.format(row.estimatedGrazingDays)} días</span></div></article>`;
  }).join("") : `<div class="panel empty">Sin evaluaciones de potreros</div>`;
}

function renderCategories(rows) {
  const maximum = Math.max(1, ...rows.map(row => row.heads));
  el("categoryList").innerHTML = rows.length ? rows.slice(0, 10).map(row => `<div class="category"><strong>${h((row.category || "").trim() || "Sin categoría")}</strong><div class="track"><div class="fill" style="width:${pct(row.heads / maximum * 100)}%"></div></div><b>${fmt.format(row.heads)}</b></div>`).join("") : `<div class="empty">Sin animales activos</div>`;
}

function renderWork(rows) {
  el("workList").innerHTML = rows.length ? rows.slice(0, 8).map(row => `<article class="work"><time>${new Date(row.date).toLocaleDateString("es-BO", { day: "2-digit", month: "short", year: "numeric" })}${row.farm ? ` · ${h(row.farm)}` : ""}</time><strong>${h(row.work || "Jornada sanitaria")} · ${h(row.troop)}</strong><p>${row.productionModule ? `${h(row.productionModule)} · ` : ""}${fmt.format(row.workedAnimals)} de ${fmt.format(row.expectedAnimals)} animales trabajados${row.animalsFromAnotherTroop > 0 ? ` · ${row.animalsFromAnotherTroop} encontrados en otra tropa` : ""}</p></article>`).join("") : `<div class="panel empty">No hay jornadas registradas</div>`;
}

function setOffline(value) { el("offlineBanner").classList.toggle("hidden", !value || !state.snapshots.length); }

async function restore() {
  const saved = savedConfiguration();
  if (!saved?.token) { showPairing(); return; }
  try {
    state.pairingToken = saved.token; state.pairing = await parsePairingToken(saved.token, false); state.snapshots = Array.isArray(saved.snapshots) ? saved.snapshots : []; state.activeFarm = saved.activeFarm || state.snapshots[0]?.farm || state.pairing.farms[0] || ""; state.activeModule = saved.activeModule || "";
    el("pairingTokenInput").value = saved.token;
    showDashboard(); if (state.snapshots.length) render(); else renderEmptyDashboard();
  } catch (error) {
    if (state.snapshots.length) { showDashboard(); render(); showToast(error.message); }
    else showPairing(error.message);
  }
}

function bindEvents() {
  el("pairButton").addEventListener("click", pairDevice);
  el("pastePairingButton").addEventListener("click", pastePairingFromClipboard);
  el("pairingFileInput").addEventListener("change", async event => { const file = event.target.files[0]; if (!file) return; el("pairingFileName").textContent = file.name; el("pairingTokenInput").value = (await file.text()).trim(); });
  el("syncButton").addEventListener("click", () => el("updateFileInput").click());
  el("importButton").addEventListener("click", () => el("updateFileInput").click());
  el("updateFileInput").addEventListener("change", event => importOwnerUpdate(event.target.files[0]));
  el("cancelUpdateButton").addEventListener("click", () => { state.pendingSnapshot = null; el("updatePreview").classList.add("hidden"); });
  el("confirmUpdateButton").addEventListener("click", confirmOwnerUpdate);
  el("farmSelect").addEventListener("change", event => { state.activeFarm = event.target.value; state.activeModule = ""; render(); });
  el("moduleSelect").addEventListener("change", event => { state.activeModule = event.target.value; if (state.activeModule && (state.metric === "costs" || state.metric === "rain")) state.metric = "births"; render(); });
  el("metricTabs").addEventListener("click", event => { const button = event.target.closest("button[data-metric]"); if (!button || button.disabled) return; state.metric = button.dataset.metric; render(); });
  el("disconnectButton").addEventListener("click", async () => { if (!confirm("¿Desvincular este celular y borrar los dashboards y borradores guardados? Para volver a usarlo necesitarás un código nuevo del veterinario.")) return; localStorage.removeItem(PRODUCT.storageKey); window.SMGField?.clearAll(); await clearDeviceIdentity(); state.pairing = null; state.snapshots = []; state.pairingToken = ""; el("pairingTokenInput").value = ""; showPairing("El celular quedó desvinculado. Solicita un código nuevo del veterinario."); });
  el("installButton").addEventListener("click", async () => { if (!state.installPrompt) return; state.installPrompt.prompt(); await state.installPrompt.userChoice; state.installPrompt = null; el("installButton").classList.add("hidden"); });
  window.addEventListener("online", () => setOffline(false));
  window.addEventListener("offline", () => setOffline(true));
  window.addEventListener("beforeinstallprompt", event => { event.preventDefault(); state.installPrompt = event; el("installButton").classList.remove("hidden"); });
  const isiPhone = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const installed = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  el("iosInstallHelp").classList.toggle("hidden", !isiPhone || installed);
}

async function ensureCurrentServiceWorker() {
  if (!("serviceWorker" in navigator) || !(location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) return;
  const build = "sm-owner-shell-v18-opening-6s";
  const previousBuild = localStorage.getItem("sm-owner-shell-version");
  const hadController = Boolean(navigator.serviceWorker.controller);
  try {
    const registration = await navigator.serviceWorker.register("service-worker.js?v=18", { updateViaCache: "none" });
    await registration.update().catch(() => {});
    const worker = registration.installing || registration.waiting;
    if (registration.waiting) registration.waiting.postMessage({ type: "SKIP_WAITING" });
    if (worker && worker.state !== "activated" && worker.state !== "redundant") {
      await new Promise(resolve => {
        const finish = () => {
          if (worker.state === "activated" || worker.state === "redundant") {
            worker.removeEventListener("statechange", finish);
            resolve();
          }
        };
        worker.addEventListener("statechange", finish);
        setTimeout(resolve, 3500);
      });
    }
    localStorage.setItem("sm-owner-shell-version", build);
    if (hadController && previousBuild !== build && !sessionStorage.getItem(`${build}-reloaded`)) {
      sessionStorage.setItem(`${build}-reloaded`, "1");
      location.reload();
      await new Promise(() => {});
    }
  } catch {
    // La consulta sigue funcionando sin conexión con la versión ya instalada.
  }
}

async function start() {
  document.title = PRODUCT.ownerName; bindEvents();
  const opening = OPENING_MESSAGES[Math.floor(Math.random() * OPENING_MESSAGES.length)];
  el("splashVerse").textContent = `“${opening[0]}”`;
  el("splashVerseReference").textContent = opening[1];
  window.setTimeout(() => el("appSplash")?.remove(), 6250);
  await ensureCurrentServiceWorker();
  await restore();
  const receivedFile = await receiveSharedFileFromUrl();
  if (!receivedFile && !state.pairing) receiveSharedPairingFromUrl();
}

start();
