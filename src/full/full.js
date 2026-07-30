function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeList(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || "").trim()).filter(Boolean);
  }

  const text = String(value || "").trim();
  return text ? [text] : [];
}

function splitKeywords(text) {
  const words = String(text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean);

  const stopWords = new Set([
    "the",
    "and",
    "for",
    "that",
    "this",
    "with",
    "from",
    "into",
    "about",
    "your",
    "you",
    "are",
    "was",
    "were",
    "have",
    "has",
    "had",
    "will",
    "can",
    "but",
    "not",
    "all",
    "its",
    "it's",
    "they",
    "their",
    "them",
    "one",
    "two",
    "three"
  ]);

  const unique = [];
  for (const word of words) {
    if (word.length < 4 || stopWords.has(word) || unique.includes(word)) {
      continue;
    }
    unique.push(word);
    if (unique.length >= 6) {
      break;
    }
  }

  return unique;
}

// Determine whether visual/tab content is relevant for this selection/response
window.isVisualRelevant = function (selection, response) {
  try {
    if (String(response?.visualCue || "").trim()) {
      return true;
    }

    const keywords = splitKeywords(selection);
    return keywords.some((word) =>
      [
        "chart",
        "graph",
        "timeline",
        "history",
        "process",
        "cycle",
        "pattern",
        "shape",
        "curve",
        "signal",
        "diagram",
        "visual",
        "image",
        "story"
      ].includes(word)
    );
  } catch (e) {
    console.error('isVisualRelevant error', e);
    return false;
  }
};

function isTimelineRelevant(response) {
  const steps = normalizeList(response.timeline);
  if (steps.length >= 3) {
    return true;
  }

  const explanation = valueToPlainText(response.fullExplanation || response.translation || "").trim();
  return explanation.length >= 180;
}

function hasTakeaways(response) {
  return normalizeList(response.keyTakeaways).length > 0;
}

function htmlToText(value) {
  const container = document.createElement("div");
  container.innerHTML = String(value || "");
  return container.textContent?.trim() || "";
}

function valueToPlainText(value) {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value.map((v) => valueToPlainText(v)).filter(Boolean).join("\n\n");
  }
  if (typeof value === "object") {
    // Common content shapes from model APIs
    if (typeof value.text === "string") return value.text.trim();
    if (typeof value.content === "string") return value.content.trim();
    if (value.message) return valueToPlainText(value.message?.content || value.message);
    // Fallback to JSON stringified but keep it readable
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

const FULL_RESPONSE_PROGRESS_MS = 18000;
let currentImageObjectUrls = [];
let loadingExitTimer = null;
let loadingProgressTimer = null;
let revealResetTimer = null;

function getStoryCard() {
  return document.getElementById("storyCard");
}

function revokeCurrentImageObjectUrls() {
  for (const objectUrl of currentImageObjectUrls) {
    URL.revokeObjectURL(objectUrl);
  }
  currentImageObjectUrls = [];
}

function setLoadingProgress(progress, elapsedMs, label = "Waiting for AI response...") {
  const progressFill = document.getElementById("loadingProgressFill");
  const progressText = document.getElementById("loadingProgressText");
  const countdown = document.getElementById("loadingCountdown");
  const subtitle = document.getElementById("loadingSubtitle");

  if (progressFill) {
    progressFill.style.width = `${Math.max(3, Math.min(100, Math.round(progress)))}%`;
  }

  if (progressText) {
    progressText.textContent = label;
  }

  if (countdown) {
    countdown.textContent = `${Math.max(0, Math.floor(elapsedMs / 1000))}s`;
  }

  if (subtitle) {
    subtitle.textContent = "Waiting for the real AI response. No timeout, no placeholder text.";
  }
}

function startLoadingProgress(durationMs = FULL_RESPONSE_PROGRESS_MS) {
  const startTime = Date.now();
  stopLoadingProgress();
  setLoadingProgress(3, 0, "Starting AI request...");

  loadingProgressTimer = window.setInterval(() => {
    const elapsedMs = Date.now() - startTime;
    const ratio = Math.min(0.98, elapsedMs / durationMs);
    const easedRatio = 1 - Math.pow(1 - ratio, 2);
    const label =
      elapsedMs > 18000
        ? "Expanding the full story..."
        : elapsedMs > 12000
          ? "Checking depth and relevance..."
          : "Building explanation...";
    setLoadingProgress(easedRatio * 96, elapsedMs, label);
  }, 120);
}

function finishLoadingProgress() {
  const countdown = document.getElementById("loadingCountdown");
  const elapsedText = countdown?.textContent || "0s";
  const elapsedMs = Number.parseInt(elapsedText, 10) * 1000 || 0;
  setLoadingProgress(100, elapsedMs, "AI response ready.");
  stopLoadingProgress();
}

function stopLoadingProgress() {
  if (loadingProgressTimer) {
    clearInterval(loadingProgressTimer);
    loadingProgressTimer = null;
  }
}

function setLoadingState(visible, completed = false) {
  const loadingOverlay = document.getElementById("loadingOverlay");
  const storyCard = getStoryCard();
  if (!loadingOverlay) {
    return;
  }

  if (loadingExitTimer) {
    clearTimeout(loadingExitTimer);
    loadingExitTimer = null;
  }

  if (visible) {
    loadingOverlay.hidden = false;
    loadingOverlay.classList.remove("is-exiting");
    startLoadingProgress();
    if (storyCard) {
      storyCard.classList.remove("is-ready");
      storyCard.classList.remove("is-revealing");
    }
    return;
  }

  if (completed) {
    finishLoadingProgress();
  } else {
    stopLoadingProgress();
  }

  loadingOverlay.classList.add("is-exiting");
  loadingExitTimer = window.setTimeout(() => {
    loadingOverlay.hidden = true;
    loadingOverlay.classList.remove("is-exiting");
    loadingExitTimer = null;
  }, 360);
}

function setStoryRevealState(ready) {
  const storyCard = getStoryCard();
  if (!storyCard) {
    return;
  }

  if (revealResetTimer) {
    clearTimeout(revealResetTimer);
    revealResetTimer = null;
  }

  storyCard.classList.toggle("is-ready", ready);

  if (!ready) {
    storyCard.classList.remove("is-revealing");
    return;
  }

  storyCard.classList.add("is-revealing");
  revealResetTimer = window.setTimeout(() => {
    storyCard.classList.remove("is-revealing");
    revealResetTimer = null;
  }, 430);
}

function renderField(title, value) {
  const text = valueToPlainText(value).trim();
  if (!text) {
    return "";
  }

  return `
    <div class="section">
      <div class="section-title">${escapeHtml(title)}</div>
      <div>${escapeHtml(text)}</div>
    </div>
  `;
}

function renderPills(items, fallbackLabel) {
  const values = normalizeList(items);
  const chips = values.length
    ? values
    : fallbackLabel
      ? [fallbackLabel]
      : [];

  if (chips.length === 0) {
    return "";
  }

  return `
    <div class="pill-row">
      ${chips.map((item) => `<span class="pill">${escapeHtml(item)}</span>`).join("")}
    </div>
  `;
}

function renderBarGraph(response) {
  const rows = [
    ["Literal", response.literalMeaning],
    ["Context", response.contextualMeaning],
    ["Notes", response.culturalNotes],
    ["Full story", response.fullExplanation || response.translation]
  ];

  const lengths = rows.map(([, value]) => valueToPlainText(value).trim().length);
  const maxLength = Math.max(...lengths, 1);

  return `
    <div class="graph">
          ${rows
        .map(([label, value], index) => {
          const text = valueToPlainText(value).trim();
          const width = Math.max(12, Math.round((lengths[index] / maxLength) * 100));
          return `
            <div class="graph-row">
              <div class="graph-label">
                <span>${escapeHtml(label)}</span>
                <span>${width}%</span>
              </div>
              <div class="graph-track" aria-hidden="true">
                <div class="graph-fill" style="width:${width}%"></div>
              </div>
              <div class="sr-copy">${escapeHtml(text.slice(0, 120))}</div>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function buildImageQuery(selection, response, mode = "focus") {
  const selectionKeywords = splitKeywords(selection);
  const contextualTerms = normalizeList(response.keyTakeaways).slice(0, 3);
  const cue = String(response.visualCue || "").trim();

  const parts =
    mode === "focus"
      ? [cue, ...selectionKeywords]
      : [cue, valueToPlainText(response.contextualMeaning || ""), valueToPlainText(response.fullExplanation || ""), ...contextualTerms];

  const unique = [];
  for (const part of parts) {
    const normalized = String(part).trim();
    if (!normalized) {
      continue;
    }
    if (!unique.includes(normalized)) {
      unique.push(normalized);
    }
    if (unique.length >= 5) {
      break;
    }
  }

  return unique.join(" ");
}

async function fetchRelevantImage(selection, response, mode = "focus") {
  const query = buildImageQuery(selection, response, mode);
  if (!query || query.length < 3) {
    return null;
  }

  const endpoint = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(query)}&gsrnamespace=6&gsrlimit=5&prop=imageinfo|info&iiprop=url|extmetadata&iiurlwidth=1200&inprop=url&format=json&origin=*`;
  const apiResponse = await fetch(endpoint);

  if (!apiResponse.ok) {
    return null;
  }

  const payload = await apiResponse.json();
  const pages = Object.values(payload?.query?.pages || {});
  const candidate = pages.find((page) => Array.isArray(page.imageinfo) && page.imageinfo[0]?.thumburl);

  if (!candidate) {
    return null;
  }

  const imageInfo = candidate.imageinfo[0];
  const imageResponse = await fetch(imageInfo.thumburl || imageInfo.url);
  if (!imageResponse.ok) {
    return null;
  }

  const blob = await imageResponse.blob();
  const objectUrl = URL.createObjectURL(blob);
  currentImageObjectUrls.push(objectUrl);

  const metadata = imageInfo.extmetadata || {};
  const caption = htmlToText(metadata.ImageDescription?.value || metadata.ObjectName?.value || candidate.title);
  const credit = htmlToText(metadata.Credit?.value || "Wikimedia Commons");

  return {
    objectUrl,
    pageUrl: imageInfo.descriptionurl || candidate.fullurl || imageInfo.url,
    title: caption || candidate.title.replace(/^File:/, ""),
    credit
  };
}

function renderImageCard(imageAsset, label, slotId) {
  if (!imageAsset) {
    return `
      <div class="image-card placeholder" data-slot="${escapeHtml(slotId)}">
        <div class="section-title">${escapeHtml(label)}</div>
        <div class="placeholder-copy">Searching for a relevant image...</div>
      </div>
    `;
  }

  return `
    <div class="image-card" data-slot="${escapeHtml(slotId)}">
      <a class="image-link" href="${escapeHtml(imageAsset.pageUrl)}" target="_blank" rel="noreferrer">
        <img
          class="online-image"
          src="${escapeHtml(imageAsset.objectUrl)}"
          alt="${escapeHtml(imageAsset.title || "Relevant online image")}"
        />
      </a>
      <div class="image-meta">
        <div class="section-title">${escapeHtml(label)}</div>
        <div class="image-title">${escapeHtml(imageAsset.title || "Relevant image from Wikimedia Commons")}</div>
        <div class="image-credit">${escapeHtml(imageAsset.credit || "Wikimedia Commons")}</div>
      </div>
    </div>
  `;
}

function updateImageSlot(slotId, imageAsset, label) {
  const slot = document.getElementById(slotId);
  if (!slot) {
    return;
  }

  slot.innerHTML = renderImageCard(imageAsset, label, slotId);
}

async function hydrateImages(selection, response, onStatus = () => {}) {
  onStatus("Full explanation ready. Looking for relevant images...");
  let imageAsset = null;
  try {
    imageAsset = await fetchRelevantImage(selection, response, "focus");
  } catch {
    imageAsset = null;
  }

  if (!imageAsset) {
    updateImageSlot("focusImageSlot", null, "Selection focus");
    updateImageSlot("quickImageSlot", null, "Quick view");
    updateImageSlot("visualImageSlot", null, "Online image");
    onStatus("Full explanation ready. No relevant online image found.");
    return;
  }

  updateImageSlot("focusImageSlot", imageAsset, "Selection focus");
  updateImageSlot("quickImageSlot", imageAsset, "Quick view");
  updateImageSlot("visualImageSlot", imageAsset, "Online image");
  onStatus("Full explanation ready. Images added.");
}

function renderTimeline(response) {
  const steps = normalizeList(response.timeline);
  const entries =
    steps.length > 0
      ? steps
      : [
          response.literalMeaning ? "Surface the literal meaning." : "Read the phrase literally first.",
          response.contextualMeaning ? "Shift to how people actually use it." : "Consider the common use in context.",
          response.culturalNotes ? "Check for cultural, technical, or domain notes." : "Notice any special domain meaning.",
          response.fullExplanation || response.translation
            ? "Bring it together into the full story."
            : "Summarize the idea in plain language."
        ];

  return `
    <ol class="timeline">
      ${entries
        .map(
          (entry, index) => `
            <li class="timeline-step-card">
              <div class="timeline-step">${index + 1}</div>
              <div>
                <p class="timeline-title">${escapeHtml(index === 0 ? "Start here" : index === entries.length - 1 ? "Finish strong" : "Next")}</p>
                <p class="timeline-copy">${escapeHtml(entry)}</p>
              </div>
            </li>
          `
        )
        .join("")}
    </ol>
  `;
}

function setActiveView(viewName) {
  const tabs = Array.from(document.querySelectorAll("[role='tab']"));
  const panels = {
    story: document.getElementById("storyView"),
    visual: document.getElementById("visualView"),
    timeline: document.getElementById("timelineView")
  };

  for (const tab of tabs) {
    const isActive = tab.id === `${viewName}Tab`;
    tab.classList.toggle("is-active", isActive);
    tab.setAttribute("aria-selected", String(isActive));
  }

  for (const [key, panel] of Object.entries(panels)) {
    if (!panel) {
      continue;
    }
    panel.hidden = key !== viewName;
  }
}

function setTabVisibility(tab, visible) {
  if (!tab) {
    return;
  }

  tab.hidden = !visible;
  tab.disabled = !visible;
}

function renderViews(selection, response) {
  const storyView = document.getElementById("storyView");
  const visualView = document.getElementById("visualView");
  const timelineView = document.getElementById("timelineView");
  const visualTab = document.getElementById("visualTab");
  const timelineTab = document.getElementById("timelineTab");

  const explanation = valueToPlainText(response.fullExplanation || response.translation || "").trim();
  const showVisual = isVisualRelevant(selection, response);
  const showTimeline = isTimelineRelevant(response);
  const showTakeaways = hasTakeaways(response);
  const storyBlocks = [
    renderField("Literal meaning", response.literalMeaning),
    renderField("Contextual meaning", response.contextualMeaning),
    renderField("Notes", response.culturalNotes),
    renderField("History and origin", response.history),
    renderField("Domain nuance", response.domainNuance),
    renderField("Typical usage", response.typicalUsage),
    renderField("Common confusion", response.commonConfusion),
    renderField("Examples", response.examples),
    renderField("Why it matters", response.whyItMatters),
    renderField("Full explanation", explanation)
  ].filter(Boolean);

  storyView.innerHTML = `
    <div class="story-grid">
      <div class="content-stack">
        <div class="panel field-list">
          ${
            storyBlocks.length > 0
              ? storyBlocks.join("")
              : `
                <div class="section">
                  <div class="section-title">Explanation</div>
                  <div>We didn't get a clean structured reply, so the model response is shown in a shorter form.</div>
                </div>
              `
          }
        </div>
        ${
          showTakeaways
            ? `<div class="panel reveal-item"><div class="section-title">Key takeaways</div>${renderPills(response.keyTakeaways, "")}</div>`
            : ""
        }
      </div>
      <div class="content-stack">
        <div id="focusImageSlot">${renderImageCard(null, "Selection focus", "focusImageSlot")}</div>
        <div id="quickImageSlot">${renderImageCard(null, "Quick view", "quickImageSlot")}</div>
      </div>
    </div>
  `;

  visualView.innerHTML = showVisual
    ? `
      <div class="reveal-item"><div id="visualImageSlot">${renderImageCard(null, "Online image", "visualImageSlot")}</div></div>
      <div class="panel reveal-item">
        <div class="section-title">Detail balance</div>
        ${renderBarGraph(response)}
      </div>
      <div class="panel reveal-item">
        <div class="section-title">Context chips</div>
        ${renderPills(splitKeywords(selection).slice(0, 6), "Selection is short")}
      </div>
    `
    : `
      <div class="panel reveal-item">
        <div class="section-title">Visuals not needed</div>
        <div>This selection reads best as text-first, so we've kept the focus on the explanation itself.</div>
      </div>
    `;

  timelineView.innerHTML = showTimeline
    ? `
      <div class="panel reveal-item">
        <div class="section-title">How the meaning unfolds</div>
        ${renderTimeline(response)}
      </div>
    `
    : `
      <div class="panel reveal-item">
        <div class="section-title">Timeline not needed</div>
        <div>The explanation is short and direct, so a timeline would mostly repeat the same idea.</div>
      </div>
    `;

  setTabVisibility(visualTab, showVisual);
  setTabVisibility(timelineTab, showTimeline);

  if (!showVisual && !showTimeline) {
    setActiveView("story");
  }
}

async function loadSelection() {
  const selectionTextEl = document.getElementById("selectionText");
  const statusTextEl = document.getElementById("statusText");
  const copyButton = document.getElementById("copyButton");
  const retryButton = document.getElementById("retryButton");
  const tabs = [
    document.getElementById("storyTab"),
    document.getElementById("visualTab"),
    document.getElementById("timelineTab")
  ];

  const settings = await chrome.storage.session.get([
    "contextualTranslatorSelection",
    "contextualTranslatorFullSelection",
    "contextualTranslatorFullResponse"
  ]);
  const selection = String(settings.contextualTranslatorSelection || "").trim();
  const cachedFullSelection = String(settings.contextualTranslatorFullSelection || "").trim();
  const cachedFullResponse = settings.contextualTranslatorFullResponse || null;
  let lastResponse = null;

  function setIdleState(disabled) {
    copyButton.disabled = disabled;
    retryButton.disabled = disabled;
    tabs.forEach((tab) => {
      if (tab) {
        tab.disabled = disabled;
      }
    });
  }

  function renderFallback(errorMessage) {
    const storyView = document.getElementById("storyView");
    const visualView = document.getElementById("visualView");
    const timelineView = document.getElementById("timelineView");
    storyView.innerHTML = `
      <div class="panel reveal-item">
        <div class="section-title">Could not explain</div>
        <div>${escapeHtml(errorMessage)}</div>
      </div>
    `;
    visualView.innerHTML = `
      <div class="panel reveal-item">
        <div class="section-title">Visual unavailable</div>
        <div>${escapeHtml(errorMessage)}</div>
      </div>
    `;
    timelineView.innerHTML = `
      <div class="panel reveal-item">
        <div class="section-title">Timeline unavailable</div>
        <div>${escapeHtml(errorMessage)}</div>
      </div>
    `;
  }

  if (!selection) {
    statusTextEl.textContent = "No selection was passed to the full story page.";
    setIdleState(true);
    renderFallback("Select some text on a page, then open the full story again.");
    setStoryRevealState(true);
    return;
  }

  selectionTextEl.textContent = selection;

  async function requestFullExplanation() {
    revokeCurrentImageObjectUrls();
    setStoryRevealState(false);
    setLoadingState(true);
    statusTextEl.textContent = "Asking the model for the full explanation...";
    setIdleState(true);
    let receivedResponse = false;

    try {
      let response = null;
      if (cachedFullResponse && cachedFullSelection === selection) {
        response = { ok: true, ...cachedFullResponse };
      }

      while (!receivedResponse) {
        if (!response) {
          response = await chrome.runtime.sendMessage({
            type: "SELECTION_TRANSLATE_REQUEST",
            mode: "full",
            text: selection
          });
        }

        if (!response?.ok) {
          const errorMessage = response?.error || "Translation failed.";
          throw new Error(errorMessage);
        }

        receivedResponse = true;
      }

      lastResponse = response;
      statusTextEl.textContent = "Full explanation ready.";

      renderViews(selection, response);
      setActiveView("story");
      setIdleState(false);
      setStoryRevealState(true);
      setLoadingState(false, true);

      hydrateImages(selection, response, (message) => {
        statusTextEl.textContent = message;
      }).catch(() => {
        updateImageSlot("focusImageSlot", null, "Selection focus");
        updateImageSlot("quickImageSlot", null, "Quick view");
        updateImageSlot("visualImageSlot", null, "Online image");
        statusTextEl.textContent = "Full explanation ready. Images unavailable.";
      });
    } catch (error) {
      statusTextEl.textContent = error.message;
      setIdleState(false);
      renderFallback(error.message);
      setStoryRevealState(true);
    } finally {
      if (!receivedResponse) {
        setLoadingState(false, false);
      }
    }
  }

  tabs.forEach((tab) => {
    if (!tab) {
      return;
    }

    tab.addEventListener("click", () => {
      const viewName = tab.id.replace("Tab", "");
      setActiveView(viewName);
    });
  });

  copyButton.addEventListener("click", async () => {
    if (!lastResponse) {
      return;
    }

    const combined = [
      `Selection: ${selection}`,
      `Literal meaning: ${valueToPlainText(lastResponse.literalMeaning || "")}`,
      `Contextual meaning: ${valueToPlainText(lastResponse.contextualMeaning || "")}`,
      `Notes: ${valueToPlainText(lastResponse.culturalNotes || "")}`,
      `History and origin: ${valueToPlainText(lastResponse.history || "")}`,
      `Domain nuance: ${valueToPlainText(lastResponse.domainNuance || "")}`,
      `Typical usage: ${valueToPlainText(lastResponse.typicalUsage || "")}`,
      `Common confusion: ${valueToPlainText(lastResponse.commonConfusion || "")}`,
      `Examples: ${valueToPlainText(lastResponse.examples || "")}`,
      `Why it matters: ${valueToPlainText(lastResponse.whyItMatters || "")}`,
      `Full explanation: ${valueToPlainText(lastResponse.fullExplanation || lastResponse.translation || "")}`
    ]
      .filter((line) => line.trim())
      .join("\n\n");

    await navigator.clipboard.writeText(combined);
    statusTextEl.textContent = "Copied the explanation.";
  });

  retryButton.addEventListener("click", () => {
    requestFullExplanation().catch((error) => {
      statusTextEl.textContent = error.message;
      setIdleState(false);
      renderFallback(error.message);
    });
  });

  requestFullExplanation().catch((error) => {
    statusTextEl.textContent = error.message;
    setIdleState(false);
    renderFallback(error.message);
    setStoryRevealState(true);
  });
}

loadSelection().catch((error) => {
  const statusTextEl = document.getElementById("statusText");
  if (statusTextEl) {
    statusTextEl.textContent = error.message;
  }
});

window.addEventListener("beforeunload", revokeCurrentImageObjectUrls);
