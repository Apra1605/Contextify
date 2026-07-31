function buildFullPrompt(selection) {
  return [
    "Output the final JSON immediately.",
    "Reply with minified JSON only (no markdown). Use fields:",
    "",
    "literalMeaning",
    "contextualMeaning",
    "origin",
    "usage",
    "examples",
    "whyItMatters",
    "explanation (2-3 rich paragraphs, 500-800 words)",
    "visualCue (<=8 words)",
    "keyTakeaways (<=8 short items)",
    "timeline (<=7 short items)",
    "",
    "Every field must relate to the highlighted text. Write explanation as a richly detailed story with vivid context, literal image, figurative use, likely origin, modern tone, comparable phrases, usage boundaries, and why it matters. Make it feel like a substantial article in 2-3 paragraphs rather than a short summary. If origin is uncertain, say what is known. Do not restate contextualMeaning or literalMeaning inside explanation. Do not add commentary outside JSON.",
    "",
    `Text: {${selection}}`
  ].join("\n");
}

function buildExplainPrompt(selection) {
  return [
    "Output the final JSON immediately. Do not explain your reasoning.",
    "Respond with valid minified JSON only. No markdown, no prose outside JSON.",
    'Use exactly this shape: {"literalMeaning":"","contextualMeaning":"","culturalNotes":""}',
    `literalMeaning: one literal sentence for {${selection}}.`,
    "contextualMeaning: two sentences on intended or figurative meaning.",
    'culturalNotes: one sentence on idiom, tone, domain, or cultural relevance; use "No special note" if none.',
    "All values must be plain English only.",
    "",
    `Highlighted text: {${selection}}`
  ].join("\n");
}

function buildPrompt(selection, mode = "brief") {
  return mode === "full" ? buildFullPrompt(selection) : buildExplainPrompt(selection);
}

function buildBriefRepairPrompt(selection, previousResponse = "") {
  return [
    "Output the final JSON immediately. Do not explain your reasoning.",
    "The previous quick explanation was malformed, partial, or unreadable.",
    "Rewrite it as valid minified JSON only. No markdown. No prose outside JSON.",
    'Use exactly this shape: {"literalMeaning":"","contextualMeaning":"","culturalNotes":""}',
    "Keep it concise, direct, and complete.",
    "Do not put JSON inside a string. Do not copy malformed syntax from the previous response.",
    "",
    `Highlighted text: {${selection}}`,
    "",
    `Previous response: ${JSON.stringify(previousResponse).slice(0, 1200)}`
  ].join("\n");
}

function extractJsonText(content) {
  const text = String(content || "").trim();
  if (!text) {
    return "";
  }

  const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  const startIndex = text.indexOf("{");
  const endIndex = text.lastIndexOf("}");
  if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
    return text.slice(startIndex, endIndex + 1).trim();
  }

  return text;
}

function decodeJsonStringFragment(value) {
  const text = String(value || "");
  try {
    return JSON.parse(`"${text}"`);
  } catch {
    return text
      .replace(/\\"/g, '"')
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\\\/g, "\\");
  }
}

function extractJsonStringField(text, fieldName) {
  const match = String(text || "").match(new RegExp(`"${fieldName}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)`, "i"));
  return decodeJsonStringFragment(match?.[1] || "").trim();
}

function extractJsonArrayField(text, fieldName) {
  const match = String(text || "").match(new RegExp(`"${fieldName}"\\s*:\\s*\\[([\\s\\S]*?)]`, "i"));
  if (!match?.[1]) {
    return [];
  }

  return Array.from(match[1].matchAll(/"((?:\\.|[^"\\])*)"/g))
    .map((entry) => decodeJsonStringFragment(entry[1]).trim())
    .filter(Boolean);
}

function normalizeParsedResponse(parsed, fallbackText = "") {
  const literalMeaning = String(parsed.literalMeaning || parsed.literal || "").trim();
  const contextualMeaning = String(parsed.contextualMeaning || parsed.contextual || parsed.context || "").trim();
  const culturalNotes = String(parsed.culturalNotes || parsed.notes || parsed.culture || parsed.origin || "").trim();
  const history = String(parsed.history || parsed.origin || "").trim();
  const domainNuance = String(parsed.domainNuance || parsed.domain || "").trim();
  const typicalUsage = String(parsed.typicalUsage || parsed.usage || "").trim();
  const commonConfusion = String(parsed.commonConfusion || parsed.confusion || "").trim();
  const examples = String(parsed.examples || parsed.example || "").trim();
  const whyItMatters = String(parsed.whyItMatters || parsed.importance || "").trim();
  const fullExplanation = String(parsed.fullExplanation || parsed.explanation || parsed.full || "").trim();
  const visualCue = String(parsed.visualCue || parsed.visual || "").trim();
  const keyTakeaways = Array.isArray(parsed.keyTakeaways || parsed.takeaways)
    ? (parsed.keyTakeaways || parsed.takeaways).map((entry) => String(entry || "").trim()).filter(Boolean)
    : [];
  const timeline = Array.isArray(parsed.timeline)
    ? parsed.timeline.map((entry) => String(entry || "").trim()).filter(Boolean)
    : [];

  return {
    literalMeaning,
    contextualMeaning,
    culturalNotes,
    history,
    domainNuance,
    typicalUsage,
    commonConfusion,
    examples,
    whyItMatters,
    fullExplanation,
    visualCue,
    keyTakeaways,
    timeline,
    translation:
      String(fullExplanation || contextualMeaning || literalMeaning || fallbackText)
        .replace(/^\{+/, "")
        .trim()
  };
}

function parseLines(content) {
  const text = String(content || "").trim();
  if (!text) {
    return null;
  }

  const jsonText = extractJsonText(text);

  if (jsonText.startsWith("{")) {
    try {
      const parsed = JSON.parse(jsonText);
      return normalizeParsedResponse(typeof parsed === "string" ? JSON.parse(parsed) : parsed, jsonText);
    } catch {
      const recovered = normalizeParsedResponse(
        {
          literalMeaning: extractJsonStringField(jsonText, "literalMeaning"),
          contextualMeaning: extractJsonStringField(jsonText, "contextualMeaning"),
          culturalNotes: extractJsonStringField(jsonText, "culturalNotes"),
          history: extractJsonStringField(jsonText, "history") || extractJsonStringField(jsonText, "origin"),
          domainNuance: extractJsonStringField(jsonText, "domainNuance"),
          typicalUsage: extractJsonStringField(jsonText, "typicalUsage") || extractJsonStringField(jsonText, "usage"),
          commonConfusion: extractJsonStringField(jsonText, "commonConfusion"),
          examples: extractJsonStringField(jsonText, "examples"),
          whyItMatters: extractJsonStringField(jsonText, "whyItMatters"),
          fullExplanation: extractJsonStringField(jsonText, "fullExplanation") || extractJsonStringField(jsonText, "explanation"),
          visualCue: extractJsonStringField(jsonText, "visualCue"),
          keyTakeaways: extractJsonArrayField(jsonText, "keyTakeaways"),
          timeline: extractJsonArrayField(jsonText, "timeline")
        },
        ""
      );

      if (recovered.literalMeaning || recovered.contextualMeaning || recovered.fullExplanation) {
        return recovered;
      }
    }
  }

  const literalMatch = text.match(/Literal(?: meaning)?:\s*([\s\S]*?)(?:\nContext|\nContextual|\nNotes|\nOrigin|\nExplanation|\nFull explanation|$)/i);
  const contextMatch = text.match(/Context(?:ual meaning)?:\s*([\s\S]*?)(?:\nNotes|\nOrigin|\nUsage|\nExplanation|\nFull explanation|$)/i);
  const notesMatch = text.match(/Notes?:\s*([\s\S]*?)(?:\nOrigin|\nUsage|\nExplanation|\nFull explanation|$)/i);
  const historyMatch = text.match(/(?:History|Origin)(?: and origin)?:\s*([\s\S]*?)(?:\nDomain nuance|\nTypical usage|\nUsage|\nCommon confusion|\nExamples|\nExplanation|\nFull explanation|$)/i);
  const domainNuanceMatch = text.match(/Domain nuance:\s*([\s\S]*?)(?:\nTypical usage|\nUsage|\nCommon confusion|\nExamples|\nExplanation|\nFull explanation|$)/i);
  const typicalUsageMatch = text.match(/(?:Typical usage|Usage):\s*([\s\S]*?)(?:\nCommon confusion|\nExamples|\nWhy it matters|\nExplanation|\nFull explanation|$)/i);
  const commonConfusionMatch = text.match(/Common confusion:\s*([\s\S]*?)(?:\nExamples|\nWhy it matters|\nExplanation|\nFull explanation|$)/i);
  const examplesMatch = text.match(/Examples:\s*([\s\S]*?)(?:\nWhy it matters|\nExplanation|\nFull explanation|$)/i);
  const whyItMattersMatch = text.match(/Why it matters:\s*([\s\S]*?)(?:\nExplanation|\nFull explanation|$)/i);
  const explanationMatch = text.match(/(?:Full explanation|Explanation):\s*([\s\S]*)/i);

  const parsed = normalizeParsedResponse({
    literalMeaning: literalMatch?.[1]?.trim() || "",
    contextualMeaning: contextMatch?.[1]?.trim() || "",
    culturalNotes: notesMatch?.[1]?.trim() || "",
    history: historyMatch?.[1]?.trim() || "",
    domainNuance: domainNuanceMatch?.[1]?.trim() || "",
    typicalUsage: typicalUsageMatch?.[1]?.trim() || "",
    commonConfusion: commonConfusionMatch?.[1]?.trim() || "",
    examples: examplesMatch?.[1]?.trim() || "",
    whyItMatters: whyItMattersMatch?.[1]?.trim() || "",
    fullExplanation: explanationMatch?.[1]?.trim() || ""
  });

  return parsed.translation ? parsed : null;
}

function toTextContent(messageContent) {
  if (typeof messageContent === "string") {
    return messageContent.trim();
  }

  if (Array.isArray(messageContent)) {
    return messageContent
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }

        if (typeof part?.text === "string") {
          return part.text;
        }

        if (typeof part?.content === "string") {
          return part.content;
        }

        if (typeof part?.value === "string") {
          return part.value;
        }

        if (part?.json && typeof part.json === "object") {
          return JSON.stringify(part.json);
        }

        return "";
      })
      .join("")
      .trim();
  }

  if (messageContent && typeof messageContent === "object") {
    if (typeof messageContent.text === "string") {
      return messageContent.text.trim();
    }

    if (typeof messageContent.content === "string") {
      return messageContent.content.trim();
    }

    return JSON.stringify(messageContent).trim();
  }

  return "";
}

function getModelText(result) {
  const candidates = [
    result?.message?.content,
    result?.outputText,
    result?.content
  ];

  for (const choice of result?.choices || []) {
    candidates.push(
      choice.message?.content,
      choice.text,
      choice.delta?.content
    );
  }

  for (const candidate of candidates) {
    const text = toTextContent(candidate);
    if (text) {
      return text;
    }
  }

  return "";
}

function hasJsonNoise(value) {
  const text = String(value || "").trim();
  return /["']?(literalMeaning|contextualMeaning|culturalNotes|fullExplanation)["']?\s*:/i.test(text) ||
    /[{}][\s\S]*["']?(literalMeaning|contextualMeaning|culturalNotes)["']?/i.test(text);
}

function cleanBriefText(value) {
  return String(value || "")
    .replace(/```(?:json)?/gi, "")
    .replace(/```/g, "")
    .replace(/^\s*[{\[]+/, "")
    .replace(/[}\]]+\s*$/, "")
    .replace(/^\s*"(literalMeaning|contextualMeaning|culturalNotes|fullExplanation)"\s*:\s*/i, "")
    .replace(/\\n/g, " ")
    .replace(/\\"/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^"+|"+$/g, "")
    .trim();
}

function needsBriefRepair(parsed) {
  if (!parsed) {
    return true;
  }

  const literalMeaning = cleanBriefText(parsed.literalMeaning);
  const contextualMeaning = cleanBriefText(parsed.contextualMeaning || parsed.fullExplanation || parsed.translation);
  const culturalNotes = cleanBriefText(parsed.culturalNotes);
  const combined = [literalMeaning, contextualMeaning, culturalNotes, parsed.translation, parsed.rawText]
    .filter(Boolean)
    .join(" ");

  return contextualMeaning.length < 35 ||
    countWords(contextualMeaning) < 6 ||
    hasJsonNoise(combined);
}

function normalizeBriefResponse(parsed, rawContent) {
  const literalMeaning = cleanBriefText(parsed?.literalMeaning || "");
  const contextualMeaning = cleanBriefText(
    parsed?.contextualMeaning ||
    parsed?.fullExplanation ||
    parsed?.translation ||
    rawContent
  );
  const culturalNotes = cleanBriefText(parsed?.culturalNotes || "");

  if (!contextualMeaning || hasJsonNoise(contextualMeaning)) {
    return null;
  }

  return {
    literalMeaning,
    contextualMeaning,
    culturalNotes,
    translation: contextualMeaning
  };
}

function responseFromRawAiText(content, selection, mode) {
  const text = String(content || "").trim();
  if (!text) {
    return null;
  }

  if (/^[\s\{\}\[\]"]+$/.test(text) || text.length < 3) {
    return null;
  }

  const cleanedText = cleanBriefText(text);
  if (mode !== "full" && (!cleanedText || hasJsonNoise(cleanedText))) {
    return null;
  }

  return {
    literalMeaning: "",
    contextualMeaning: mode === "full" ? text.slice(0, 280) : cleanedText,
    culturalNotes: "",
    history: "",
    domainNuance: "",
    typicalUsage: "",
    commonConfusion: "",
    fullExplanation: mode === "full" ? text : "",
    visualCue: selection,
    keyTakeaways: [],
    timeline: [],
    translation: mode === "full" ? text : cleanedText
  };
}

function countWords(value) {
  return String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

const fullPreloadCache = new Map();

async function preloadFullExplanation(selection) {
  const text = String(selection || "").trim();
  if (!text) {
    return null;
  }

  const cached = fullPreloadCache.get(text);
  if (cached) {
    return cached.promise;
  }

  const promise = translateSelection(text, "full")
    .then((response) => {
      chrome.storage.session.set({
        contextualTranslatorFullSelection: text,
        contextualTranslatorFullResponse: response
      });
      fullPreloadCache.set(text, {
        promise: Promise.resolve(response),
        response
      });
      return response;
    })
    .catch((error) => {
      fullPreloadCache.delete(text);
      throw error;
    });

  fullPreloadCache.set(text, { promise });
  return promise;
}

function getCachedFullExplanation(selection) {
  const text = String(selection || "").trim();
  const cached = fullPreloadCache.get(text);
  return cached || null;
}

const GROQ_API_KEY = "ADD THE API KEY FROM THR README!";
const GROQ_MODEL = "llama-3.1-8b-instant";
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

async function sendToGroq(prompt) {
  const response = await fetch(GROQ_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GROQ_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        {
          role: "system",
          content: "You are a precise language explanation assistant. Return only the requested answer."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.2,
      max_tokens: 1600
    })
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Groq request failed: ${response.status} ${text}`);
  }

  const data = await response.json().catch(() => null);
  const content = data?.choices?.[0]?.message?.content || data?.choices?.[0]?.text || "";

  if (!content) {
    throw new Error("Groq returned an empty response.");
  }

  return { message: { content } };
}

function buildEmptyRetryPrompt(selection, mode) {
  return [
    "Output the final answer immediately. Do not explain your reasoning.",
    buildPrompt(selection, mode),
    "",
    "The previous model response was empty.",
    "Return the requested answer now with readable content."
  ].join("\n");
}

async function translateSelection(selection, mode = "brief") {
  let result;
  let rawContent = "";
  let prompt;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      prompt = attempt === 0 ? buildPrompt(selection, mode) : buildEmptyRetryPrompt(selection, mode);
      result = await sendToGroq(prompt);
      rawContent = getModelText(result);
      if (rawContent && rawContent.length >= 3) {
        break;
      }
    } catch (error) {
      throw error;
    }
  }

  if (!result) {
    throw new Error("The AI response did not arrive.");
  }

  if (!rawContent || rawContent.length < 3) {
    throw new Error("The model responded without readable text. Try again.");
  }

  if (mode !== "full") {
    let parsedBrief = parseLines(rawContent) || responseFromRawAiText(rawContent, selection, mode);

    if (needsBriefRepair(parsedBrief)) {
      const retryPrompt = buildBriefRepairPrompt(selection, rawContent);
      const retryResult = await sendToGroq(retryPrompt);
      const retryContent = getModelText(retryResult);
      const repairedBrief = parseLines(retryContent) || responseFromRawAiText(retryContent, selection, mode);

      if (repairedBrief && !needsBriefRepair(repairedBrief)) {
        rawContent = retryContent;
        parsedBrief = repairedBrief;
      }
    }

    const cleanBrief = normalizeBriefResponse(parsedBrief, rawContent);

    if (cleanBrief) {
      const displayText = cleanBrief.contextualMeaning;
      return {
        model: "groq-llama-3.1-8b-instant",
        mode,
        rawText: "",
        contextualMeaning: cleanBrief.contextualMeaning,
        translation: displayText,
        literalMeaning: cleanBrief.literalMeaning,
        culturalNotes: cleanBrief.culturalNotes
      };
    }

    throw new Error("The model returned an unreadable quick explanation. Try again.");
  }

  let parsed = parseLines(rawContent) || responseFromRawAiText(rawContent, selection, mode);

  if (!parsed) {
    throw new Error("The model responded without readable text. Try again.");
  }

  return {
    model: "groq-llama-3.1-8b-instant",
    mode,
    rawText: rawContent,
    ...parsed
  };
}

chrome.runtime.onInstalled.addListener(() => {
  console.log("Contextify installed.");
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "PING") {
    sendResponse({
      ok: true,
      tabId: sender?.tab?.id ?? null
    });
    return;
  }

  if (message?.type === "OPEN_FULL_EXPLANATION_PAGE") {
    const selection = String(message.text || "");
    chrome.storage.session
      .set({
        contextualTranslatorSelection: selection
      })
      .then(() => {
        chrome.tabs.create({
          url: chrome.runtime.getURL("src/full/full.html")
        });
      });
    sendResponse({ ok: true });
    return;
  }

  if (message?.type === "PRELOAD_FULL_EXPLANATION") {
    const selectionText = String(message.text || "").trim();
    preloadFullExplanation(selectionText).catch(() => {
      // ignore preload errors; full page will still retry normally.
    });
    sendResponse({ ok: true });
    return true;
  }

  if (message?.type !== "SELECTION_TRANSLATE_REQUEST") {
    return;
  }

  const selectionText = String(message.text || "").trim();
  if (message.mode === "full") {
    const cachedEntry = getCachedFullExplanation(selectionText);
    if (cachedEntry) {
      cachedEntry.promise
        .then((response) => {
          sendResponse({ ok: true, model: "groq-llama-3.1-8b-instant", mode: "full", ...response });
        })
        .catch((error) => {
          sendResponse({ ok: false, error: error.message });
        });
      return true;
    }
  }

  translateSelection(selectionText, message.mode === "full" ? "full" : "brief")
    .then((result) => {
      sendResponse({
        ok: true,
        ...result
      });
    })
    .catch((error) => {
      sendResponse({
        ok: false,
        error: error.message
      });
    });

  return true;
});
