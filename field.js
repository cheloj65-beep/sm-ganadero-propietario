"use strict";

(() => {
  const OUTBOX_KEY = "sm-field-outbox.v1";
  const DRAFT_KEY = "sm-field-drafts.v1";
  const FIELD_CONTRACT = "sm-field-work.v1";
  const ENVELOPE_CONTRACT = "sm-field-work-envelope.v1";
  const local = { tab: "jornada", workEntries: [], reproEntries: [], workCandidate: null, reproCandidate: null };
  const uid = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}-4${Math.random().toString(16).slice(2)}`;
  const today = () => new Date().toLocaleDateString("en-CA");
  const currentTime = () => new Date().toTimeString().slice(0, 5);
  const normalized = value => String(value || "").replace(/\s+/g, "").toLocaleUpperCase("es");
  const numberOrNull = value => { const parsed = Number(String(value || "").replace(",", ".")); return Number.isFinite(parsed) && parsed > 0 ? parsed : null; };

  function readJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; }
    catch { return fallback; }
  }

  function writeJson(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
  function outbox() { return readJson(OUTBOX_KEY, []).filter(item => item && item.recordId); }
  function saveOutbox(rows) { writeJson(OUTBOX_KEY, rows); updatePendingChip(); }
  function pairingKey() { return compactGuid(state.pairing?.pairingId || "sin-vincular"); }
  function allDrafts() { return readJson(DRAFT_KEY, {}); }
  function draftName(kind) { return `${pairingKey()}|${state.activeFarm}|${kind}`; }
  function loadDraft(kind) { return allDrafts()[draftName(kind)] || {}; }
  function saveDraft(kind, value) { const drafts = allDrafts(); drafts[draftName(kind)] = value; writeJson(DRAFT_KEY, drafts); }
  function removeDraft(kind) { const drafts = allDrafts(); delete drafts[draftName(kind)]; writeJson(DRAFT_KEY, drafts); }
  function activeSnapshotForField() { return state.activeFarm === "__all__" ? null : state.snapshots.find(item => item.farm === state.activeFarm) || state.snapshots[0] || null; }
  function fieldData() { return activeSnapshotForField()?.fieldData || null; }
  function modules(data) { return data?.productionModules?.length ? data.productionModules : ["Cría"]; }
  function opt(value, selected) { return `<option value="${h(value)}" ${String(value) === String(selected) ? "selected" : ""}>${h(value)}</option>`; }
  function inputValue(id) { return el(id)?.value?.trim() || ""; }
  function selectedAnimal(candidate) { return candidate ? `${candidate.tag || "Sin tatuaje"} · ${candidate.electronicId || "sin caravana electrónica"} · ${candidate.category || "sin categoría"}` : ""; }

  function findAnimal(code) {
    const key = normalized(code);
    if (!key) return null;
    return fieldData()?.animals?.find(animal => normalized(animal.electronicId) === key || normalized(animal.tag) === key) || null;
  }

  function capturedAt(date, time) {
    const parsed = new Date(`${date || today()}T${time || currentTime()}:00`);
    return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
  }

  function refresh() {
    const enabled = Boolean(state.pairing && isVeterinarian());
    el("fieldWorkSection")?.classList.toggle("hidden", !enabled);
    el("fieldNavLink")?.classList.toggle("hidden", !enabled);
    if (el("mobileFooter")) el("mobileFooter").textContent = enabled
      ? "SM Ganadero Campo · registros confirmados y protegidos · funciona sin internet"
      : "SM Ganadero · Una solución de Calivet Bolivia · consulta segura";
    document.title = enabled ? "SM Ganadero Campo" : "SM Ganadero Propietario";
    if (!enabled) return;
    renderTabs();
    if (state.activeFarm === "__all__") {
      const message = `<div class="field-card wide-card"><h3>Elige una propiedad</h3><p>Para registrar datos, selecciona una propiedad específica en la lista superior. La vista “Todas las propiedades” es solo de consulta.</p></div>`;
      el("fieldJornadaPane").innerHTML = message; el("fieldReproductionPane").innerHTML = message;
    } else if (!fieldData()) {
      const message = `<div class="field-card wide-card"><h3>Falta la ficha de trabajo</h3><p>Importa un archivo .smvet creado con la versión nueva de la computadora. Ese archivo incorpora animales, temporadas y toros autorizados para trabajar sin internet.</p></div>`;
      el("fieldJornadaPane").innerHTML = message; el("fieldReproductionPane").innerHTML = message;
    } else {
      renderWorkPane(); renderReproductionPane();
    }
    renderSendPane(); updatePendingChip();
  }

  function renderTabs() {
    document.querySelectorAll("[data-field-tab]").forEach(button => button.classList.toggle("active", button.dataset.fieldTab === local.tab));
    el("fieldJornadaPane")?.classList.toggle("hidden", local.tab !== "jornada");
    el("fieldReproductionPane")?.classList.toggle("hidden", local.tab !== "reproduccion");
    el("fieldSendPane")?.classList.toggle("hidden", local.tab !== "envio");
  }

  function renderWorkPane() {
    const data = fieldData(); const draft = loadDraft("jornada");
    el("fieldJornadaPane").innerHTML = `
      <article class="field-card wide-card">
        <h3>1 · Preparar la jornada</h3><p>La fecha corresponde al día real en que se tomó el dato. No se reemplaza por la fecha de importación.</p>
        <div class="field-grid">
          <div class="field-control"><label>Propiedad</label><input value="${h(state.activeFarm)}" disabled></div>
          <div class="field-control"><label>Actividad</label><select id="fwModule">${modules(data).map(value => opt(value, draft.productionModule || state.activeModule || modules(data)[0])).join("")}</select></div>
          <div class="field-control"><label>Fecha del trabajo</label><input id="fwDate" type="date" value="${h(draft.date || today())}"></div>
          <div class="field-control"><label>Tipo de jornada</label><select id="fwType">${["Pesaje", "Jornada sanitaria", "Inventario y clasificación", "Manejo general"].map(value => opt(value, draft.workType || "Pesaje")).join("")}</select></div>
          <div class="field-control"><label>Tropa o grupo</label><select id="fwTroop"><option value="">Sin grupo</option>${["Cabecera", "Cuerpo", "Cola", "Recría", ...new Set(data.animals.map(item => item.troop).filter(Boolean))].filter((value,index,array)=>array.indexOf(value)===index).map(value => opt(value, draft.troop)).join("")}</select></div>
          <div class="field-control"><label>Veterinario responsable</label><input id="fwResponsible" value="${h(draft.responsible || state.pairing.ownerName || "")}" autocomplete="name"></div>
          <div class="field-control wide"><label>Observación de la jornada</label><textarea id="fwNotes" placeholder="Opcional">${h(draft.notes || "")}</textarea></div>
        </div>
      </article>
      <article class="field-card wide-card">
        <h3>2 · Leer y confirmar cada animal</h3>
        <div class="device-guide"><span class="device-dot"></span><div><b>XRS2 como lector Bluetooth</b><p>Empareja el bastón en Bluetooth del celular, toca el cuadro de lectura y escanea. El número aparecerá como si fuera un teclado. SM Ganadero no guarda hasta que presiones Confirmar animal.</p></div></div>
        <label class="scan-label" for="fwScan">Caravana electrónica o identificación/tatuaje</label>
        <div class="scan-row"><input id="fwScan" class="scan-box" inputmode="numeric" autocomplete="off" placeholder="Toca aquí y lee con el XRS2"><button id="fwLookup" class="field-secondary" type="button">Buscar animal</button></div>
        <div id="fwCandidate" class="candidate-card">Esperando una lectura del XRS2 o un número escrito manualmente.</div>
        <div class="field-grid" style="margin-top:12px">
          <div class="field-control"><label>Peso tomado (kg)</label><input id="fwWeight" inputmode="decimal" placeholder="Opcional"></div>
          <div class="field-control"><label>Condición corporal (1–5)</label><input id="fwBody" inputmode="decimal" placeholder="Opcional"></div>
          <div class="field-control wide"><label>Observación del animal</label><input id="fwAnimalNotes" placeholder="Opcional"></div>
        </div>
        <div class="field-actions"><button id="fwConfirm" class="field-primary" type="button" disabled>Confirmar animal</button></div>
        <div id="fwConfirmed" class="confirmed-list"></div>
      </article>
      <article class="field-card wide-card">
        <h3>3 · Guardar la jornada</h3><p>Los animales confirmados quedarán en el celular hasta enviarlos e importarlos en la laptop.</p>
        <div class="field-actions"><button id="fwSave" class="field-primary" type="button">Guardar jornada (${local.workEntries.length})</button></div>
      </article>`;
    bindDraftInputs("jornada", ["fwModule", "fwDate", "fwType", "fwTroop", "fwResponsible", "fwNotes"]);
    el("fwScan").addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); lookupWorkAnimal(); } });
    el("fwLookup").addEventListener("click", lookupWorkAnimal); el("fwConfirm").addEventListener("click", confirmWorkAnimal); el("fwSave").addEventListener("click", saveWorkSession);
    renderWorkEntries();
  }

  function lookupWorkAnimal() {
    local.workCandidate = findAnimal(inputValue("fwScan"));
    const card = el("fwCandidate");
    if (!local.workCandidate) { card.className = "candidate-card error"; card.innerHTML = "No se encontró esta caravana o identificación en la propiedad seleccionada. No se guardó nada."; el("fwConfirm").disabled = true; return; }
    card.className = "candidate-card ready"; card.innerHTML = `<strong>${h(selectedAnimal(local.workCandidate))}</strong>${h(local.workCandidate.breed)} · ${h(local.workCandidate.troop || "sin grupo")} · último peso ${fmt1.format(local.workCandidate.weightKg || 0)} kg`;
    el("fwWeight").value = local.workCandidate.weightKg > 0 ? String(local.workCandidate.weightKg) : "";
    el("fwBody").value = local.workCandidate.bodyConditionScore > 0 ? String(local.workCandidate.bodyConditionScore) : "";
    el("fwConfirm").disabled = false;
  }

  function confirmWorkAnimal() {
    const animal = local.workCandidate; if (!animal) return;
    if (local.workEntries.some(item => item.animalId === animal.id)) { showToast(`${animal.tag} ya fue confirmado en esta jornada`); return; }
    local.workEntries.push({ entryId: uid(), animalId: animal.id, electronicId: animal.electronicId || "", tag: animal.tag || "", weightKg: numberOrNull(inputValue("fwWeight")), bodyConditionScore: numberOrNull(inputValue("fwBody")), capturedAtUtc: new Date().toISOString(), status: "Confirmado", semenInventoryItemId: null, sireReference: "", notes: inputValue("fwAnimalNotes") });
    local.workCandidate = null; el("fwScan").value = ""; el("fwWeight").value = ""; el("fwBody").value = ""; el("fwAnimalNotes").value = ""; el("fwCandidate").className = "candidate-card"; el("fwCandidate").textContent = "Animal confirmado. Esperando la siguiente lectura."; el("fwConfirm").disabled = true; renderWorkEntries(); el("fwScan").focus();
  }

  function renderWorkEntries() {
    const container = el("fwConfirmed"); if (!container) return;
    container.innerHTML = local.workEntries.length ? local.workEntries.map((item, index) => `<div class="confirmed-row"><div><strong>${h(item.tag || item.electronicId)}</strong><small>${item.weightKg ? `${fmt1.format(item.weightKg)} kg` : "sin peso"}${item.bodyConditionScore ? ` · CC ${fmt1.format(item.bodyConditionScore)}` : ""}</small></div><button type="button" data-remove-work="${index}" aria-label="Quitar">Quitar</button></div>`).join("") : `<div class="empty-field">Aún no hay animales confirmados.</div>`;
    container.querySelectorAll("[data-remove-work]").forEach(button => button.addEventListener("click", () => { local.workEntries.splice(Number(button.dataset.removeWork), 1); renderWorkEntries(); }));
    if (el("fwSave")) el("fwSave").textContent = `Guardar jornada (${local.workEntries.length})`;
  }

  function saveWorkSession() {
    if (!local.workEntries.length) { showToast("Confirma al menos un animal antes de guardar la jornada"); return; }
    if (!inputValue("fwResponsible")) { showToast("Escribe el veterinario responsable"); el("fwResponsible").focus(); return; }
    const rows = outbox(); rows.push({ recordId: uid(), type: "Jornada", farm: state.activeFarm, productionModule: inputValue("fwModule"), date: inputValue("fwDate"), workType: inputValue("fwType"), troop: inputValue("fwTroop"), responsible: inputValue("fwResponsible"), notes: inputValue("fwNotes"), seasonId: null, stage: "", round: "", animals: local.workEntries, queuedAtUtc: new Date().toISOString() });
    saveOutbox(rows); local.workEntries = []; removeDraft("jornada"); showToast("Jornada guardada en el celular"); renderWorkPane(); renderSendPane();
  }

  function renderReproductionPane() {
    const data = fieldData(); const draft = loadDraft("reproduccion"); const seasons = data.seasons || [];
    const chosenSeason = draft.seasonId || seasons[0]?.id || "";
    const sires = (data.sires || []).filter(item => !chosenSeason || item.seasonId === chosenSeason);
    el("fieldReproductionPane").innerHTML = `
      <article class="field-card wide-card">
        <h3>1 · Preparar el trabajo reproductivo</h3><p>Elige una etapa. En Día 8 e IATF se registra la hora individual de cada animal.</p>
        <div class="field-grid">
          <div class="field-control"><label>Propiedad</label><input value="${h(state.activeFarm)}" disabled></div>
          <div class="field-control"><label>Actividad</label><select id="frModule">${modules(data).filter(value => value === "Cría" || value === "Cabaña").map(value => opt(value, draft.productionModule || state.activeModule || "Cría")).join("")}</select></div>
          <div class="field-control wide"><label>Temporada</label><select id="frSeason">${seasons.length ? seasons.map(value => `<option value="${value.id}" ${value.id === chosenSeason ? "selected" : ""}>${h(value.name)} · ${h(value.productionModule)}</option>`).join("") : `<option value="">Sin temporada disponible</option>`}</select></div>
          <div class="field-control"><label>Etapa</label><select id="frStage">${["Preservicio", "Día 0", "Día 8", "IATF", "Diagnóstico IATF", "Diagnóstico final"].map(value => opt(value, draft.stage || "Preservicio")).join("")}</select></div>
          <div class="field-control"><label>Turno</label><select id="frRound">${["Cabecera", "Cuerpo", "Cola", "General"].map(value => opt(value, draft.round || "Cabecera")).join("")}</select></div>
          <div class="field-control"><label>Fecha real</label><input id="frDate" type="date" value="${h(draft.date || today())}"></div>
          <div class="field-control"><label>Veterinario responsable</label><input id="frResponsible" value="${h(draft.responsible || state.pairing.ownerName || "")}"></div>
          <div class="field-control wide"><label>Observación general</label><textarea id="frNotes" placeholder="Opcional">${h(draft.notes || "")}</textarea></div>
        </div>
      </article>
      <article class="field-card wide-card">
        <h3>2 · Evaluar y confirmar</h3>
        <label class="scan-label" for="frScan">Caravana electrónica o identificación/tatuaje</label>
        <div class="scan-row"><input id="frScan" class="scan-box" inputmode="numeric" autocomplete="off" placeholder="Lee con XRS2 o escribe el número"><button id="frLookup" class="field-secondary" type="button">Buscar animal</button></div>
        <div id="frCandidate" class="candidate-card">Esperando una lectura.</div>
        <div class="field-grid" style="margin-top:12px">
          <div class="field-control"><label>Resultado</label><select id="frStatus"></select></div>
          <div class="field-control"><label>Hora individual</label><input id="frTime" type="time" value="${currentTime()}"></div>
          <div class="field-control"><label>Peso (kg)</label><input id="frWeight" inputmode="decimal" placeholder="Obligatorio en preservicio"></div>
          <div class="field-control"><label>Condición corporal (1–5)</label><input id="frBody" inputmode="decimal" placeholder="Opcional"></div>
          <div id="frSireControl" class="field-control wide"><label>Toro o pajuela</label><select id="frSire"><option value="">Selecciona</option>${sires.map(item => `<option value="${item.id}" data-code="${h(item.bullCode)}">${h(item.bullCode)} · ${h(item.breed)} · ${item.availableStraws} disponibles</option>`).join("")}</select></div>
          <div class="field-control wide"><label>Observación individual</label><input id="frAnimalNotes" placeholder="Opcional"></div>
        </div>
        <p class="repro-note">Presionar Enter después de leer solo busca el animal. El registro se incorpora únicamente con Confirmar animal.</p>
        <div class="field-actions"><button id="frConfirm" class="field-primary" type="button" disabled>Confirmar animal</button></div>
        <div id="frConfirmed" class="confirmed-list"></div>
      </article>
      <article class="field-card wide-card"><h3>3 · Guardar trabajo reproductivo</h3><div class="field-actions"><button id="frSave" class="field-primary" type="button">Guardar trabajo (${local.reproEntries.length})</button></div></article>`;
    bindDraftInputs("reproduccion", ["frModule", "frSeason", "frStage", "frRound", "frDate", "frResponsible", "frNotes"]);
    el("frSeason").addEventListener("change", () => { saveCurrentDraft("reproduccion"); renderReproductionPane(); });
    el("frStage").addEventListener("change", () => { updateReproControls(); saveCurrentDraft("reproduccion"); });
    el("frScan").addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); lookupReproAnimal(); } });
    el("frLookup").addEventListener("click", lookupReproAnimal); el("frConfirm").addEventListener("click", confirmReproAnimal); el("frSave").addEventListener("click", saveReproduction);
    updateReproControls(); renderReproEntries();
  }

  function reproStatuses(stage) {
    if (stage === "Preservicio") return ["Apta", "No apta", "Descarte"];
    if (stage === "Día 0") return ["Dispositivo colocado", "No aplicado"];
    if (stage === "Día 8") return ["Dispositivo presente", "Dispositivo perdido"];
    if (stage === "IATF") return ["Inseminada", "No inseminada"];
    return ["Preñada", "Vacía", "Aborto", "Pendiente"];
  }

  function updateReproControls() {
    const stage = inputValue("frStage"); if (!stage) return;
    el("frStatus").innerHTML = reproStatuses(stage).map(value => opt(value, "")).join("");
    el("frSireControl").classList.toggle("hidden", stage !== "IATF");
    el("frTime").closest(".field-control").classList.toggle("hidden", stage !== "Día 8" && stage !== "IATF");
    el("frWeight").placeholder = stage === "Preservicio" ? "Obligatorio en preservicio" : "Opcional";
  }

  function lookupReproAnimal() {
    local.reproCandidate = findAnimal(inputValue("frScan")); const card = el("frCandidate");
    if (!local.reproCandidate) { card.className = "candidate-card error"; card.textContent = "No se encontró el animal en esta propiedad. No se guardó nada."; el("frConfirm").disabled = true; return; }
    card.className = "candidate-card ready"; card.innerHTML = `<strong>${h(selectedAnimal(local.reproCandidate))}</strong>${h(local.reproCandidate.breed)} · ${h(local.reproCandidate.category)} · ${h(local.reproCandidate.troop || "sin grupo")}`;
    el("frWeight").value = local.reproCandidate.weightKg > 0 ? String(local.reproCandidate.weightKg) : ""; el("frBody").value = local.reproCandidate.bodyConditionScore > 0 ? String(local.reproCandidate.bodyConditionScore) : ""; el("frTime").value = currentTime(); el("frConfirm").disabled = false;
  }

  function confirmReproAnimal() {
    const animal = local.reproCandidate; if (!animal) return;
    if (local.reproEntries.some(item => item.animalId === animal.id)) { showToast(`${animal.tag} ya fue confirmado en este trabajo`); return; }
    const stage = inputValue("frStage"), weight = numberOrNull(inputValue("frWeight")), body = numberOrNull(inputValue("frBody"));
    if (stage === "Preservicio" && !weight) { showToast("En preservicio registra el peso del animal"); el("frWeight").focus(); return; }
    if (body !== null && (body < 1 || body > 5)) { showToast("La condición corporal debe estar entre 1 y 5"); return; }
    const sire = el("frSire"), semenId = stage === "IATF" && sire?.value ? sire.value : null, sireCode = semenId ? sire.selectedOptions[0]?.dataset.code || "" : "";
    if (stage === "IATF" && inputValue("frStatus") === "Inseminada" && !semenId) { showToast("Selecciona el toro o pajuela"); return; }
    local.reproEntries.push({ entryId: uid(), animalId: animal.id, electronicId: animal.electronicId || "", tag: animal.tag || "", weightKg: weight, bodyConditionScore: body, capturedAtUtc: capturedAt(inputValue("frDate"), inputValue("frTime")), status: inputValue("frStatus"), semenInventoryItemId: semenId, sireReference: sireCode, notes: inputValue("frAnimalNotes") });
    local.reproCandidate = null; el("frScan").value = ""; el("frWeight").value = ""; el("frBody").value = ""; el("frAnimalNotes").value = ""; el("frCandidate").className = "candidate-card"; el("frCandidate").textContent = "Animal confirmado. Esperando la siguiente lectura."; el("frConfirm").disabled = true; renderReproEntries(); el("frScan").focus();
  }

  function renderReproEntries() {
    const container = el("frConfirmed"); if (!container) return;
    container.innerHTML = local.reproEntries.length ? local.reproEntries.map((item,index) => `<div class="confirmed-row"><div><strong>${h(item.tag || item.electronicId)}</strong><small>${h(item.status)}${item.sireReference ? ` · ${h(item.sireReference)}` : ""} · ${latestText(item.capturedAtUtc)}</small></div><button type="button" data-remove-repro="${index}">Quitar</button></div>`).join("") : `<div class="empty-field">Aún no hay animales confirmados.</div>`;
    container.querySelectorAll("[data-remove-repro]").forEach(button => button.addEventListener("click", () => { local.reproEntries.splice(Number(button.dataset.removeRepro), 1); renderReproEntries(); }));
    if (el("frSave")) el("frSave").textContent = `Guardar trabajo (${local.reproEntries.length})`;
  }

  function saveReproduction() {
    if (!local.reproEntries.length) { showToast("Confirma al menos un animal"); return; }
    if (!inputValue("frSeason")) { showToast("No hay una temporada reproductiva seleccionada"); return; }
    if (!inputValue("frResponsible")) { showToast("Escribe el veterinario responsable"); return; }
    const rows = outbox(); rows.push({ recordId: uid(), type: "Reproducción", farm: state.activeFarm, productionModule: inputValue("frModule"), date: inputValue("frDate"), workType: "Jornada reproductiva", troop: "", responsible: inputValue("frResponsible"), notes: inputValue("frNotes"), seasonId: inputValue("frSeason"), stage: inputValue("frStage"), round: inputValue("frRound"), animals: local.reproEntries, queuedAtUtc: new Date().toISOString() });
    saveOutbox(rows); local.reproEntries = []; removeDraft("reproduccion"); showToast("Trabajo reproductivo guardado en el celular"); renderReproductionPane(); renderSendPane();
  }

  function bindDraftInputs(kind, ids) {
    ids.forEach(id => el(id)?.addEventListener("input", () => saveCurrentDraft(kind)));
  }

  function saveCurrentDraft(kind) {
    const prefix = kind === "jornada" ? "fw" : "fr";
    saveDraft(kind, kind === "jornada" ? { productionModule: inputValue(`${prefix}Module`), date: inputValue(`${prefix}Date`), workType: inputValue(`${prefix}Type`), troop: inputValue(`${prefix}Troop`), responsible: inputValue(`${prefix}Responsible`), notes: inputValue(`${prefix}Notes`) } : { productionModule: inputValue(`${prefix}Module`), seasonId: inputValue(`${prefix}Season`), stage: inputValue(`${prefix}Stage`), round: inputValue(`${prefix}Round`), date: inputValue(`${prefix}Date`), responsible: inputValue(`${prefix}Responsible`), notes: inputValue(`${prefix}Notes`) });
  }

  function renderSendPane() {
    const rows = outbox(), animals = rows.reduce((sum,row) => sum + (row.animals?.length || 0), 0);
    el("fieldSendPane").innerHTML = `
      <article class="field-card wide-card"><h3>Trabajo pendiente de incorporar</h3><div class="field-summary"><div><b>${rows.length}</b><span>bloques guardados</span></div><div><b>${animals}</b><span>registros de animales</span></div></div><div class="field-status ${rows.length ? "warning" : ""}" style="margin-top:12px">${rows.length ? "Guardados en este celular; todavía no incorporados en la laptop." : "Todo el trabajo de este celular fue entregado o eliminado."}</div></article>
      <article class="field-card wide-card"><h3>Enviar sin internet compartido</h3><p>Crea un archivo .smtrabajo protegido. Puedes compartirlo por WhatsApp como documento. En la laptop abre Sincronización con el celular y elige Importar .smtrabajo.</p><div class="ios-field-note"><strong>Android y iPhone:</strong> si WhatsApp no aparece al compartir, guarda el archivo en Archivos/Descargas y adjúntalo como documento.</div><div class="field-actions"><button id="fieldExport" class="field-primary" type="button" ${rows.length ? "" : "disabled"}>Compartir .smtrabajo</button><button id="fieldClear" class="field-danger" type="button" ${rows.length ? "" : "disabled"}>Vaciar después de importar</button></div></article>
      <article class="field-card wide-card"><h3>Detalle</h3><div class="outbox-list">${rows.length ? rows.map((row,index) => `<div class="outbox-row"><div><strong>${h(row.type)} · ${h(row.farm)}</strong><small>${h(row.stage || row.workType)} · ${h(row.date)} · ${row.animals.length} animales</small></div><button type="button" data-remove-outbox="${index}">Quitar</button></div>`).join("") : `<div class="empty-field">No hay trabajos pendientes.</div>`}</div></article>`;
    el("fieldExport")?.addEventListener("click", exportWork); el("fieldClear")?.addEventListener("click", clearDelivered);
    el("fieldSendPane").querySelectorAll("[data-remove-outbox]").forEach(button => button.addEventListener("click", () => { if (!confirm("¿Quitar este bloque pendiente? Esta acción no se puede deshacer.")) return; const current=outbox(); current.splice(Number(button.dataset.removeOutbox),1); saveOutbox(current); renderSendPane(); }));
  }

  async function exportWork() {
    const records = outbox(); if (!records.length || !state.pairing) return;
    try {
      const identity = await getOrCreateDeviceIdentity();
      const createdAtUtc = new Date().toISOString();
      const body = { contractVersion: FIELD_CONTRACT, packageId: uid(), pairingId: state.pairing.pairingId, deviceId: identity.deviceId, operator: state.pairing.ownerName || "Veterinario", createdAtUtc, records };
      const payloadBytes = new TextEncoder().encode(JSON.stringify(body));
      const payload = toBase64Url(payloadBytes);
      const message = `${ENVELOPE_CONTRACT}|${compactGuid(state.pairing.pairingId)}|${createdAtUtc}|${payload}`;
      const key = await crypto.subtle.importKey("raw", fromBase64Url(state.pairing.secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
      const authenticationTag = toBase64Url(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
      const envelope = { contractVersion: ENVELOPE_CONTRACT, pairingId: state.pairing.pairingId, createdAtUtc, payload, authenticationTag };
      const fileName = `SM-Trabajo-${today()}-${records.length}.smtrabajo`;
      const file = new File([JSON.stringify(envelope, null, 2)], fileName, { type: "application/json" });
      if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) await navigator.share({ title: "Trabajo SM Ganadero", text: "Trabajo de campo confirmado para incorporar en la laptop.", files: [file] });
      else { const url=URL.createObjectURL(file); const link=document.createElement("a"); link.href=url; link.download=fileName; link.click(); window.setTimeout(()=>URL.revokeObjectURL(url),1000); }
      showToast("Archivo .smtrabajo preparado. Consérvalo hasta importarlo en la laptop");
    } catch (error) {
      if (error?.name !== "AbortError") window.alert(error?.message || "No se pudo crear el archivo .smtrabajo.");
    }
  }

  function clearDelivered() {
    if (!confirm("Haz esto solo después de que la laptop confirme la importación. ¿Vaciar los trabajos pendientes de este celular?")) return;
    saveOutbox([]); renderSendPane(); showToast("Lista pendiente vaciada");
  }

  function updatePendingChip() {
    const rows=outbox(), animals=rows.reduce((sum,row)=>sum+(row.animals?.length||0),0); if (el("fieldPendingChip")) el("fieldPendingChip").textContent = `${animals} ${animals === 1 ? "pendiente" : "pendientes"}`;
  }

  function clearAll() { localStorage.removeItem(OUTBOX_KEY); localStorage.removeItem(DRAFT_KEY); local.workEntries=[]; local.reproEntries=[]; }

  function init() {
    document.querySelectorAll("[data-field-tab]").forEach(button => button.addEventListener("click", () => { local.tab=button.dataset.fieldTab; renderTabs(); if (local.tab === "envio") renderSendPane(); }));
    el("farmSelect")?.addEventListener("change", () => window.setTimeout(refresh, 0)); el("moduleSelect")?.addEventListener("change", () => window.setTimeout(refresh, 0));
    refresh();
  }

  window.SMGField = { refresh, clearAll };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
