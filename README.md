# Page Summarizer (Chrome extension)

Summarizes the current web page **offline** — no API key, no internet, no outside AI.
It uses our own extractive summarizer (TF-IDF + TextRank) in `summarizer.js`.

## Install
1. Open `chrome://extensions`, turn on **Developer mode**.
2. Click **Load unpacked** → choose this `page-summarizer` folder.
3. Pin the extension. After any code change, click ↻ on its card to reload.

## Use
- Click the icon (or press **Alt+S**) → pick a length → **Summarize**.
- Select 40+ words of text first to summarize just the selection.

## Files
- `summarizer.js` — the algorithm (sentence splitting → TF-IDF → TextRank → pick top sentences).
- `popup.js` — reads the page's paragraphs and shows the result.
- `popup.html` / `popup.css` — the popup window.
- `test/test.html` — test bench to try the algorithm on any pasted text.
  Run `python -m http.server 8765` in this folder, then open http://localhost:8765/test/test.html.

## Limits
- Extractive: it picks real sentences from the page, it doesn't rewrite them.
- Tuned for English (stopword list and stemmer).
- Doesn't work on `chrome://` pages, the Chrome Web Store, or PDFs in Chrome's viewer.
