const statusEl = document.getElementById("status");
const selectionInput = document.getElementById("selectionInput");
const explainBtn = document.getElementById("explainBtn");
const fullBtn = document.getElementById("fullBtn");
const copyBtn = document.getElementById("copyBtn");
const preview = document.getElementById("preview");
const previewText = document.getElementById("previewText");

function setStatus(message) {
  if (statusEl) statusEl.textContent = message;
}

async function loadLastSelection() {
  try {
    const settings = await chrome.storage.session.get(["contextualTranslatorSelection"]);
    const sel = String(settings.contextualTranslatorSelection || "").trim();
    if (sel) {
      selectionInput.value = sel;
    }
  } catch (e) {
    // ignore
  }
}

// options button removed; no-op

copyBtn?.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(selectionInput.value || "");
    setStatus("Copied selection");
  } catch {
    setStatus("Copy failed");
  }
});

explainBtn?.addEventListener("click", async () => {
  const text = (selectionInput.value || "").trim();
  if (!text) {
    setStatus("No text to explain.");
    return;
  }

  setStatus("Asking for brief explanation...");
  preview.hidden = true;
  try {
    const response = await chrome.runtime.sendMessage({ type: "SELECTION_TRANSLATE_REQUEST", mode: "brief", text });
    if (!response?.ok) {
      throw new Error(response?.error || "Request failed");
    }

    const quick = response.contextualMeaning || response.translation || response.fullExplanation || "(no result)";
    previewText.textContent = quick;
    preview.hidden = false;
    setStatus("Explanation ready");
  } catch (e) {
    setStatus(String(e?.message || e));
  }
});

fullBtn?.addEventListener("click", async () => {
  const text = (selectionInput.value || "").trim();
  if (!text) {
    setStatus("No text to explain.");
    return;
  }

  setStatus("Opening full story...");
  try {
    await chrome.runtime.sendMessage({ type: "OPEN_FULL_EXPLANATION_PAGE", text });
    window.close();
  } catch (e) {
    setStatus("Could not open full story");
  }
});

loadLastSelection().then(() => setStatus("Ready"));
