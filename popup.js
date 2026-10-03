// Length option -> number of key points (in addition to the TL;DR sentence).
const LENGTHS = { short: 3, medium: 6, long: 10 };

const $ = (id) => document.getElementById(id);
let lastSummary = null;

$("go").addEventListener("click", run);
$("copy").addEventListener("click", copySummary);

function setStatus(msg, isError = false) {
  $("status").textContent = msg;
  $("status").className = isError ? "error" : "";
}

// Runs inside the web page: collect the readable paragraphs, skipping menus, footers, etc.
function extractPage() {
  const selection = window.getSelection()?.toString().trim() || "";
  const root =
    document.querySelector("article") ||
    document.querySelector("main") ||
    document.body;

  const blocks = [...root.querySelectorAll("p, li, blockquote, dd, figcaption")]
    .filter((el) => !el.closest("nav, header, footer, aside, form, [role='navigation']"))
    .filter((el) => !el.querySelector("p, li")) // avoid counting nested text twice
    .map((el) => el.innerText.replace(/\s+/g, " ").trim())
    .filter((t) => t.split(" ").length >= 8);

  // Fallback for pages that don't use <p> tags.
  const text = blocks.length ? [...new Set(blocks)].join("\n") : root.innerText;
  return { title: document.title, url: location.href, text, selection };
}

async function getPage() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || /^(chrome|edge|about|chrome-extension):/.test(tab.url || "")) {
    throw new Error("Chrome doesn't allow extensions to read this page.");
  }
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: extractPage,
  });
  return result;
}

async function run() {
  $("copy").hidden = true;
  $("output").replaceChildren();
  try {
    setStatus("Reading page…");
    const page = await getPage();
    const useSelection = page.selection.split(/\s+/).length >= 40;
    const text = useSelection ? page.selection : page.text;
    if (!text.trim()) throw new Error("No readable text found on this page.");

    const t0 = performance.now();
    const summary = Summarizer.summarize(text, {
      title: page.title,
      count: LENGTHS[$("length").value],
    });
    const ms = Math.round(performance.now() - t0);

    lastSummary = { ...summary, title: page.title, url: page.url };
    render(summary);

    const s = summary.stats;
    setStatus(
      `${useSelection ? "Selection" : "Page"}: ${s.words.toLocaleString()} words · ` +
      `${s.readingMinutes} min read · summarized in ${ms} ms` +
      (s.truncated ? " · very long page, only the first part was used" : "")
    );
    $("copy").hidden = false;
  } catch (err) {
    setStatus(err.message || String(err), true);
  }
}

// Build the result with DOM nodes (textContent), so page text can never inject HTML.
function render({ tldr, points, keywords }) {
  const out = $("output");
  const el = (tag, text, cls) => {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    if (cls) node.className = cls;
    return node;
  };

  if (!tldr) {
    out.append(el("p", "Not enough text to summarize."));
    return;
  }
  out.append(el("h3", "TL;DR"), el("p", tldr, "tldr"));

  if (points.length) {
    out.append(el("h3", "Key points"));
    const ul = el("ul");
    points.forEach((p) => ul.append(el("li", p)));
    out.append(ul);
  }

  if (keywords.length) {
    out.append(el("h3", "Keywords"));
    const chips = el("div", "", "chips");
    keywords.forEach((k) => chips.append(el("span", k, "chip")));
    out.append(chips);
  }
}

async function copySummary() {
  const { tldr, points, keywords, title, url } = lastSummary;
  const text =
    `${title}\n${url}\n\nTL;DR: ${tldr}\n\n` +
    points.map((p) => `- ${p}`).join("\n") +
    `\n\nKeywords: ${keywords.join(", ")}`;
  await navigator.clipboard.writeText(text);
  setStatus("Copied to clipboard.");
}
