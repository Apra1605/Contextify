const HIGHLIGHT_CLASS = "ces-highlight-enabled";
const STYLE_ID = "ces-highlight-style";
const HOST_ID = "ces-selection-popup-host";
const UNDERLINE_CLASS = "ces-underline-mark";

let selectionPopupHost = null;
let selectionTextEl = null;
let loadingTextEl = null;
let resultTextEl = null;
let translateButton = null;
let fullStoryButton = null;
let closeButton = null;
let selectionPopupText = "";
let activeSelectionRange = null;
let hoverTooltipWrapper = null;
let hoverTooltipText = "";
let hoverTooltip = null;
let currentShortExplanation = "";
let pendingUnderlineRange = null;
let isExplanationPending = false;
let updateScheduled = false;
let activeRequestId = 0;

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) {
    return;
  }

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    html.${HIGHLIGHT_CLASS} {
      outline: 2px solid rgba(75, 85, 99, 0.22) !important;
      outline-offset: -2px !important;
    }


    .${UNDERLINE_CLASS} {
      display: inline;
      border-bottom: 2px solid #2563eb;
      padding-bottom: 1px;
      transition: background-color 180ms ease, color 180ms ease;
      cursor: help;
    }

    .${UNDERLINE_CLASS}:hover {
      background-color: rgba(59, 130, 246, 0.08);
    }

    .ces-hover-tooltip {
      position: fixed;
      z-index: 2147483650;
      max-width: min(320px, calc(100vw - 28px));
      padding: 12px 14px;
      border-radius: 16px;
      background: rgba(15, 23, 42, 0.92);
      color: #f8fafc;
      font: 500 12px/1.55 system-ui, sans-serif;
      white-space: pre-wrap;
      box-shadow: 0 20px 50px rgba(15, 23, 42, 0.3);
      pointer-events: none;
      opacity: 0;
      transform: translateY(6px);
      transition: opacity 180ms ease, transform 180ms ease;
    }

    .ces-hover-tooltip.is-visible {
      opacity: 1;
      transform: translateY(0);
    }
  `;

  document.documentElement.appendChild(style);
}

function setHighlightEnabled(enabled) {
  ensureStyles();
  document.documentElement.classList.toggle(HIGHLIGHT_CLASS, enabled);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function removeUnderlineWrapper(wrapper) {
  if (!wrapper) {
    return;
  }

  if (!wrapper.isConnected) {
    return;
  }

  wrapper.removeEventListener("mouseenter", handleUnderlineHover);
  wrapper.removeEventListener("mouseleave", hideHoverTooltip);
  wrapper.removeEventListener("mousemove", handleUnderlineMove);

  const parent = wrapper.parentNode;
  while (wrapper.firstChild) {
    parent.insertBefore(wrapper.firstChild, wrapper);
  }
  parent.removeChild(wrapper);
  parent.normalize();
  hideHoverTooltip();
}

function beginPopupAction() {
  pendingUnderlineRange = activeSelectionRange ? activeSelectionRange.cloneRange() : null;
  isExplanationPending = true;
}

function endPopupAction() {
  isExplanationPending = false;
  pendingUnderlineRange = null;
}

function underlineRange(range) {
  if (!range || range.collapsed) {
    return null;
  }

  const wrapper = document.createElement("span");
  wrapper.className = UNDERLINE_CLASS;
  wrapper.dataset.cesUnderline = "true";
  wrapper.dataset.cesStatus = "loading";

  try {
    const contents = range.extractContents();
    wrapper.appendChild(contents);
    range.insertNode(wrapper);
  } catch {
    return null;
  }

  wrapper.addEventListener("mouseenter", handleUnderlineHover);
  wrapper.addEventListener("mouseleave", hideHoverTooltip);
  wrapper.addEventListener("mousemove", handleUnderlineMove);

  return wrapper;
}

function formatUnderlineExplanation(payload) {
  const literalMeaning = String(payload?.literalMeaning || "").trim();
  const contextualMeaning = String(payload?.contextualMeaning || payload?.translation || payload?.rawText || "").trim();
  const culturalNotes = String(payload?.culturalNotes || "").trim();
  const sections = [];

  if (literalMeaning) {
    sections.push(`Literal: ${literalMeaning}`);
  }

  if (contextualMeaning) {
    sections.push(`Meaning: ${contextualMeaning}`);
  }

  if (culturalNotes) {
    sections.push(`Note: ${culturalNotes}`);
  }

  return sections.join("\n\n").trim();
}

function setUnderlineExplanation(wrapper, payload) {
  if (!wrapper || !wrapper.isConnected) {
    return;
  }

  const explanation = formatUnderlineExplanation(payload);
  wrapper.dataset.cesStatus = explanation ? "ready" : "empty";
  wrapper.__cesExplanation = explanation;
}

function getSelectionText() {
  const selection = window.getSelection();
  if (!selection) {
    return "";
  }

  return selection.toString().trim();
}

function ensureHoverTooltip() {
  if (hoverTooltip) {
    return hoverTooltip;
  }

  const tooltip = document.createElement("div");
  tooltip.className = "ces-hover-tooltip";
  document.body.appendChild(tooltip);
  hoverTooltip = tooltip;
  return tooltip;
}

function showHoverTooltip(text, rect) {
  if (!text) {
    return;
  }

  const tooltip = ensureHoverTooltip();
  tooltip.textContent = text;
  tooltip.classList.add("is-visible");

  const padding = 12;
  const tooltipRect = tooltip.getBoundingClientRect();
  let left = rect.left + rect.width / 2 - tooltipRect.width / 2;
  let top = rect.top - tooltipRect.height - 12;

  if (left < padding) {
    left = padding;
  }
  if (left + tooltipRect.width > window.innerWidth - padding) {
    left = window.innerWidth - tooltipRect.width - padding;
  }
  if (top < padding) {
    top = rect.bottom + 12;
  }

  tooltip.style.left = `${Math.round(left)}px`;
  tooltip.style.top = `${Math.round(top)}px`;
}

function hideHoverTooltip() {
  if (!hoverTooltip) {
    return;
  }

  hoverTooltip.classList.remove("is-visible");
}

function handleUnderlineHover(event) {
  const explanation = event.currentTarget.__cesExplanation;
  if (!explanation) {
    return;
  }

  const rect = event.currentTarget.getBoundingClientRect();
  showHoverTooltip(explanation, rect);
}

function handleUnderlineMove(event) {
  if (!hoverTooltip || !hoverTooltip.classList.contains("is-visible")) {
    return;
  }

  const rect = event.currentTarget.getBoundingClientRect();
  showHoverTooltip(event.currentTarget.__cesExplanation, rect);
}

function getSelectionRect() {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return null;
  }

  const range = selection.getRangeAt(0);
  const rects = range.getClientRects();
  const rect = rects[0] ?? range.getBoundingClientRect();

  if (!rect || (rect.width === 0 && rect.height === 0)) {
    return null;
  }

  return rect;
}

function getSelectionRange() {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return null;
  }

  const range = selection.getRangeAt(0);
  if (range.collapsed) {
    return null;
  }

  return range.cloneRange();
}

function rangesAreEqual(a, b) {
  if (!a || !b) {
    return false;
  }

  return (
    a.startContainer === b.startContainer &&
    a.startOffset === b.startOffset &&
    a.endContainer === b.endContainer &&
    a.endOffset === b.endOffset
  );
}

function renderResult(payload) {
  function toPlainText(value) {
    if (value == null) return "";
    if (typeof value === "string") return value.trim();
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    if (Array.isArray(value)) return value.map((v) => toPlainText(v)).filter(Boolean).join("\n\n");
    if (typeof value === "object") {
      if (typeof value.text === "string") return value.text.trim();
      if (typeof value.content === "string") return value.content.trim();
      if (value.message) return toPlainText(value.message?.content || value.message);
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    }
    return String(value);
  }
  const translation = String(payload.translation || "").trim();
  const literalMeaning = String(payload.literalMeaning || "").trim();
  const contextualMeaning = String(payload.contextualMeaning || "").trim();
  const culturalNotes = String(payload.culturalNotes || "").trim();
  const rawText = String(payload.rawText || "").trim();

  if (payload.mode !== "full") {
    const hasStructuredExplanation = literalMeaning || contextualMeaning || culturalNotes || translation;

    if (payload.fullExplanation && !hasStructuredExplanation) {
      const fullText = toPlainText(payload.fullExplanation);
      resultTextEl.textContent = fullText;
      resultTextEl.classList.add("is-visible");
      currentShortExplanation = fullText;
      return;
    }

    if (rawText && !hasStructuredExplanation) {
      resultTextEl.textContent = rawText;
      resultTextEl.classList.add("is-visible");
      currentShortExplanation = rawText;
      return;
    }
  }

  const sections = [];

  if (literalMeaning) {
    sections.push(`
      <div class="section">
        <span class="section-title">Literal meaning</span>
        <div>${escapeHtml(literalMeaning)}</div>
      </div>
    `);
  }

  if (contextualMeaning || translation) {
    sections.push(`
      <div class="section">
        <span class="section-title">Contextual meaning</span>
        <div>${escapeHtml(contextualMeaning || translation)}</div>
      </div>
    `);
  }

  if (culturalNotes) {
    sections.push(`
      <div class="section">
        <span class="section-title">Notes</span>
        <div>${escapeHtml(culturalNotes)}</div>
      </div>
    `);
  }

  if (sections.length === 0) {
    sections.push(`
      <div class="section">
        <span class="section-title">Translation</span>
        <div>${escapeHtml(translation || "No explanation returned.")}</div>
      </div>
    `);
  }

  resultTextEl.innerHTML = sections.join("");
  resultTextEl.classList.add("is-visible");
  currentShortExplanation = [contextualMeaning, translation, literalMeaning, culturalNotes]
    .filter(Boolean)
    .slice(0, 2)
    .join(" — ");
}

function ensureSelectionPopup() {
  if (selectionPopupHost) {
    return selectionPopupHost;
  }

  const host = document.createElement("div");
  host.id = HOST_ID;
  host.style.position = "fixed";
  host.style.left = "0";
  host.style.top = "0";
  host.style.zIndex = "2147483647";
  host.style.display = "none";
  host.style.pointerEvents = "auto";

  const shadowRoot = host.attachShadow({ mode: "open" });
  shadowRoot.innerHTML = `
    <style>
      :host {
        all: initial;
      }

      .bubble {
        display: grid;
        gap: 8px;
        width: fit-content;
        min-width: 0;
        max-width: min(640px, calc(100vw - 24px));
        max-height: calc(100vh - 48px);
        padding: 14px 16px;
        border: 1px solid rgba(148, 163, 184, 0.22);
        border-radius: 20px;
        background: rgba(255, 255, 255, 0.92);
        color: #1f2937;
        box-shadow: 0 18px 36px rgba(15, 23, 42, 0.10);
        font: 500 13px/1.35 system-ui, sans-serif;
        backdrop-filter: blur(14px);
        pointer-events: auto;
        overflow: auto;
      }

      .selection {
        max-width: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: #6b7280;
        font-size: 12px;
      }

      .result {
        display: none;
        color: #1f2937;
        font-size: 13px;
        line-height: 1.55;
        white-space: pre-wrap;
        word-break: break-word;
      }

      .result.is-visible {
        display: grid;
        gap: 8px;
      }

      .section {
        display: grid;
        gap: 4px;
      }

      .section-title {
        display: block;
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: #6b7280;
      }

      .loading {
        display: none;
        position: relative;
        overflow: hidden;
        grid-template-columns: auto 1fr;
        gap: 10px;
        align-items: center;
        min-width: min(340px, calc(100vw - 64px));
        padding: 12px;
        border: 1px solid rgba(99, 102, 241, 0.16);
        border-radius: 18px;
        background:
          radial-gradient(circle at 18% 20%, rgba(96, 165, 250, 0.22), transparent 30%),
          radial-gradient(circle at 82% 24%, rgba(168, 85, 247, 0.18), transparent 32%),
          linear-gradient(135deg, rgba(248, 250, 252, 0.96), rgba(239, 246, 255, 0.88));
        color: #334155;
        font-size: 12px;
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.78);
      }

      .loading::before {
        content: "";
        position: absolute;
        inset: -60%;
        background: conic-gradient(from 90deg, transparent, rgba(96, 165, 250, 0.16), rgba(168, 85, 247, 0.18), transparent);
      }

      .loading.is-visible {
        display: grid;
      }

      .loading-orb {
        position: relative;
        width: 34px;
        height: 34px;
        border-radius: 999px;
        background:
          radial-gradient(circle at 50% 50%, #ffffff 0 22%, transparent 24%),
          conic-gradient(from 0deg, #2563eb, #8b5cf6, #06b6d4, #2563eb);
        box-shadow: 0 0 0 6px rgba(99, 102, 241, 0.08), 0 10px 24px rgba(79, 70, 229, 0.25);
        animation: cesOrbPulse 1.25s ease-in-out infinite;
        z-index: 1;
      }

      .loading-orb::before,
      .loading-orb::after {
        content: "";
        position: absolute;
        inset: -7px;
        border-radius: inherit;
        border: 1px solid rgba(99, 102, 241, 0.24);
        animation: cesRipple 1.6s ease-out infinite;
      }

      .loading-orb::after {
        animation-delay: 0.45s;
      }

      .loading-copy {
        position: relative;
        display: grid;
        gap: 7px;
        min-width: 0;
        z-index: 1;
      }

      .loading-title {
        color: #1f2937;
        font-weight: 750;
        letter-spacing: -0.01em;
      }

      .loading-subtitle {
        color: #64748b;
        font-size: 11px;
      }

      .loading-bars {
        display: grid;
        gap: 5px;
        width: 100%;
      }

      .loading-bars span {
        position: relative;
        overflow: hidden;
        height: 5px;
        border-radius: 999px;
        background: rgba(148, 163, 184, 0.18);
      }

      .loading-bars span::after {
        content: "";
        position: absolute;
        inset: 0;
        width: 45%;
        border-radius: inherit;
        background: linear-gradient(90deg, #60a5fa, #8b5cf6, #22d3ee);
        animation: cesBarSweep 1.05s ease-in-out infinite;
      }

      .loading-bars span:nth-child(2)::after {
        animation-delay: 0.16s;
        width: 34%;
      }

      .loading-bars span:nth-child(3)::after {
        animation-delay: 0.32s;
        width: 55%;
      }

      @keyframes cesOrbPulse {
        0%, 100% {
          transform: scale(0.95);
          filter: saturate(1);
        }
        50% {
          transform: scale(1.05);
          filter: saturate(1.35);
        }
      }

      @keyframes cesRipple {
        0% {
          opacity: 0.6;
          transform: scale(0.72);
        }
        100% {
          opacity: 0;
          transform: scale(1.55);
        }
      }

      @keyframes cesBarSweep {
        0% {
          transform: translateX(-115%);
        }
        52% {
          transform: translateX(70%);
        }
        100% {
          transform: translateX(225%);
        }
      }

      .actions {
        display: flex;
        gap: 8px;
        align-items: center;
      }

      button {
        border: 1px solid rgba(148, 163, 184, 0.18);
        border-radius: 999px;
        padding: 8px 12px;
        background: linear-gradient(180deg, #f9fafb 0%, #e5e7eb 100%);
        color: #111827;
        font: 600 12px/1.2 system-ui, sans-serif;
        cursor: pointer;
      }

      .secondary {
        background: transparent;
        color: #6b7280;
      }
    </style>
    <div class="bubble">
      <div class="selection" id="selectionText"></div>
      <div class="loading" id="loadingText">
        <span class="loading-orb" aria-hidden="true"></span>
        <span class="loading-copy">
          <span class="loading-title">Finding the meaning</span>
          <span class="loading-subtitle">Reading literal, context, and nuance...</span>
          <span class="loading-bars" aria-hidden="true">
            <span></span>
            <span></span>
            <span></span>
          </span>
        </span>
      </div>
      <div class="result" id="resultText"></div>
      <div class="actions">
        <button id="translateButton" type="button">Explain</button>
        <button id="fullStoryButton" type="button">Full story</button>
        <button id="closeButton" type="button" class="secondary">Close</button>
      </div>
    </div>
  `;

  selectionTextEl = shadowRoot.getElementById("selectionText");
  loadingTextEl = shadowRoot.getElementById("loadingText");
  resultTextEl = shadowRoot.getElementById("resultText");
  translateButton = shadowRoot.getElementById("translateButton");
  fullStoryButton = shadowRoot.getElementById("fullStoryButton");
  closeButton = shadowRoot.getElementById("closeButton");

  const stopSelection = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };

  host.addEventListener("mousedown", stopSelection);
  host.addEventListener("pointerdown", stopSelection);
  translateButton.addEventListener("mousedown", stopSelection);
  translateButton.addEventListener("pointerdown", stopSelection);
  fullStoryButton.addEventListener("mousedown", stopSelection);
  fullStoryButton.addEventListener("pointerdown", stopSelection);
  translateButton.addEventListener("pointerdown", beginPopupAction);
  fullStoryButton.addEventListener("pointerdown", beginPopupAction);

  translateButton.addEventListener("click", async () => {
    if (!selectionPopupText) {
      return;
    }

    const requestId = ++activeRequestId;
    const rangeToUnderline = pendingUnderlineRange ? pendingUnderlineRange.cloneRange() : null;
    let underlineWrapper = null;
    if (rangeToUnderline) {
      underlineWrapper = underlineRange(rangeToUnderline);
    }

    loadingTextEl.classList.add("is-visible");
    resultTextEl.classList.remove("is-visible");
    resultTextEl.textContent = "";
    translateButton.disabled = true;

    try {
      const response = await chrome.runtime.sendMessage({
        type: "SELECTION_TRANSLATE_REQUEST",
        requestId,
        text: selectionPopupText
      });

      if (requestId !== activeRequestId) {
        return;
      }

      if (!response?.ok) {
        throw new Error(response?.error || "Translation failed.");
      }

      loadingTextEl.classList.remove("is-visible");
      translateButton.disabled = false;
      fullStoryButton.disabled = false;
      if (!underlineWrapper && rangeToUnderline) {
        underlineWrapper = underlineRange(rangeToUnderline);
      }
      setUnderlineExplanation(underlineWrapper, response);
      renderResult(response);
      endPopupAction();
    } catch (error) {
      if (requestId !== activeRequestId) {
        return;
      }

      removeUnderlineWrapper(underlineWrapper);
      loadingTextEl.classList.remove("is-visible");
      translateButton.disabled = false;
      fullStoryButton.disabled = false;
      resultTextEl.innerHTML = `
        <div class="section">
          <span class="section-title">Could not explain</span>
          <div>${escapeHtml(error.message)}</div>
        </div>
      `;
      resultTextEl.classList.add("is-visible");
      endPopupAction();
    }
  });

  fullStoryButton.addEventListener("click", async () => {
    if (!selectionPopupText) {
      return;
    }

    fullStoryButton.disabled = true;
    try {
      await chrome.runtime.sendMessage({
        type: "PRELOAD_FULL_EXPLANATION",
        text: selectionPopupText
      });
      await chrome.runtime.sendMessage({
        type: "OPEN_FULL_EXPLANATION_PAGE",
        text: selectionPopupText
      });
    } finally {
      fullStoryButton.disabled = false;
      endPopupAction();
    }
  });

  closeButton.addEventListener("click", () => {
    activeRequestId += 1;
    hideSelectionPopup();
  });

  document.body?.appendChild(host) ?? document.documentElement.appendChild(host);

  selectionPopupHost = host;
  return selectionPopupHost;
}

function hideSelectionPopup() {
  if (!selectionPopupHost) {
    return;
  }

  selectionPopupHost.style.display = "none";
  if (selectionTextEl) {
    selectionTextEl.style.display = "";
  }
  selectionPopupText = "";
  activeSelectionRange = null;
  pendingUnderlineRange = null;
  isExplanationPending = false;
}

function clearSelectionPopupResult() {
  if (loadingTextEl) {
    loadingTextEl.classList.remove("is-visible");
  }

  if (resultTextEl) {
    resultTextEl.classList.remove("is-visible");
    resultTextEl.textContent = "";
  }

  if (translateButton) {
    translateButton.disabled = false;
  }

  if (fullStoryButton) {
    fullStoryButton.disabled = false;
  }

  currentShortExplanation = "";
  pendingUnderlineRange = null;
  isExplanationPending = false;
}

function positionSelectionPopup(rect) {
  const host = ensureSelectionPopup();
  const margin = 12;
  const fallbackWidth = 280;
  const fallbackHeight = 44;

  host.style.display = "block";
  host.style.visibility = "hidden";
  host.style.left = "0";
  host.style.top = "0";

  requestAnimationFrame(() => {
    const popupRect = host.getBoundingClientRect();
    const width = popupRect.width || fallbackWidth;
    const height = popupRect.height || fallbackHeight;

    const spaceRight = window.innerWidth - rect.right - margin;
    const spaceLeft = rect.left - margin;
    const placeRight = spaceRight >= width || spaceRight >= spaceLeft;

    let left = placeRight ? rect.right + margin : rect.left - width - margin;
    let top = rect.top - height - 8;

    if (top < margin) {
      top = rect.bottom + margin;
    }

    const maxLeft = Math.max(margin, window.innerWidth - width - margin);
    const maxTop = Math.max(margin, window.innerHeight - height - margin);

    left = clamp(left, margin, maxLeft);
    top = clamp(top, margin, maxTop);

    host.style.left = `${Math.round(left)}px`;
    host.style.top = `${Math.round(top)}px`;
    host.style.visibility = "visible";
  });
}

function updateSelectionPopup() {
  updateScheduled = false;

  const text = getSelectionText();
  const rect = getSelectionRect();
  const range = getSelectionRange();

  if (!text || !rect || !range) {
    if (isExplanationPending && selectionPopupHost?.style.display === "block") {
      return;
    }
    hideSelectionPopup();
    return;
  }

  ensureSelectionPopup();
  const selectionChanged =
    text !== selectionPopupText || !rangesAreEqual(range, activeSelectionRange);
  if (selectionChanged) {
    activeRequestId += 1;
    clearSelectionPopupResult();
  }

  selectionPopupText = text;
  activeSelectionRange = range;
  selectionTextEl.textContent = text;
  positionSelectionPopup(rect);
}

function scheduleSelectionPopupUpdate() {
  if (updateScheduled) {
    return;
  }

  updateScheduled = true;
  requestAnimationFrame(updateSelectionPopup);
}

document.addEventListener("selectionchange", scheduleSelectionPopupUpdate);
document.addEventListener("mouseup", scheduleSelectionPopupUpdate);
document.addEventListener("pointerup", scheduleSelectionPopupUpdate);
document.addEventListener("keyup", scheduleSelectionPopupUpdate);
document.addEventListener("touchend", scheduleSelectionPopupUpdate);
window.addEventListener("scroll", scheduleSelectionPopupUpdate, true);
window.addEventListener("resize", scheduleSelectionPopupUpdate);

setHighlightEnabled(true);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "SET_HIGHLIGHT") {
    setHighlightEnabled(Boolean(message.enabled));
    sendResponse({
      ok: true,
      enabled: Boolean(message.enabled)
    });
  }
});
