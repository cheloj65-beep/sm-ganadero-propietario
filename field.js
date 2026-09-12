"use strict";

// Mobile is consultation-only. These keys are read, never migrated or deleted:
// older confirmed work and drafts must remain recoverable after upgrading.
(() => {
  const KEYS = ["sm-field-outbox.v1", "sm-field-drafts.v1"];

  function inspectPending() {
    const raw = {};
    let pending = false;
    try {
      for (const key of KEYS) {
        const value = localStorage.getItem(key);
        raw[key] = value;
        if (!value) continue;
        try {
          const parsed = JSON.parse(value);
          if (parsed && (typeof parsed !== "object" || Object.keys(parsed).length > 0)) pending = true;
        } catch { pending = true; } // Preserve malformed data verbatim for review.
      }
      return { raw, pending, error: false };
    } catch { return { raw, pending: true, error: true }; }
  }

  function hasPending() { return inspectPending().pending; }

  function refresh() {
    // Also neutralize old markup if the browser restores a previous page.
    el("fieldWorkSection")?.classList.add("hidden");
    el("fieldNavLink")?.classList.add("hidden");
    document.title = "SM Ganadero · Consulta";
    if (el("mobileFooter")) el("mobileFooter").textContent = "SM Ganadero · Solo consulta · Registra los cambios en la computadora";
    const status = inspectPending();
    for (const prefix of ["legacyWork", "legacyPairing"]) {
      el(prefix + "Section")?.classList.toggle("hidden", !status.pending);
      const text = el(prefix + "Status");
      if (text) text.textContent = status.error
        ? "No se pudo comprobar el almacenamiento anterior. No borres datos ni desvincules este celular; solicita revisión."
        : "Este celular conserva trabajos o borradores anteriores. No se borraron ni se enviarán a la PC. Guarda una copia para revisión antes de cualquier limpieza.";
      const button = el(prefix + "Download");
      if (button) button.disabled = status.error || !status.pending;
    }
  }

  function downloadRecovery() {
    const status = inspectPending();
    if (status.error) { window.alert("No se pudo leer todo el almacenamiento. No se creó una copia incompleta."); return; }
    if (!status.pending) { showToast("No hay trabajos anteriores para respaldar"); return; }
    if (!window.confirm("Esta copia contiene datos ganaderos y borradores, sin claves de acceso. Guárdala en un lugar privado. Es solo para revisión: no se importa automáticamente en SM Ganadero. ¿Crear copia?")) return;
    try {
      // No pairing token, secret or device credentials are exported.
      const backup = {
        contractVersion: "sm-mobile-recovery.v1",
        createdAtUtc: new Date().toISOString(),
        purpose: "Revisión manual de trabajos anteriores. No es una actualización ni autoriza su incorporación.",
        storage: status.raw
      };
      const file = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(file);
      const link = document.createElement("a");
      link.href = url;
      link.download = `SM-Respaldo-movil-anterior-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30000);
      showToast("Copia preparada. Comprueba que se guardó; los originales permanecen en el celular");
    } catch { window.alert("No se pudo preparar la copia. Los trabajos anteriores siguen en este celular."); }
  }

  function init() {
    for (const prefix of ["legacyWork", "legacyPairing"])
      el(prefix + "Download")?.addEventListener("click", downloadRecovery);
    window.addEventListener("storage", refresh);
    refresh();
  }

  // Compatibility with the dashboard hooks; clearing never removes legacy work.
  window.SMGField = Object.freeze({ refresh, hasPending, clearAll: () => {} });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
