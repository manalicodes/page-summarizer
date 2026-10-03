// Our own extractive summarizer — no API, no internet, runs entirely in the browser.
//
// Pipeline:
//   1. Split the text into sentences.
//   2. Turn each sentence into a list of meaningful word "stems".
//   3. Weigh words with TF-IDF (rare-but-repeated words matter most).
//   4. Build a similarity graph between sentences and run TextRank
//      (a sentence is important if it is similar to many other important sentences).
//   5. Add small bonuses: early position, overlap with the page title.
//   6. Pick the top sentences, skipping near-duplicates, and return them in reading order.
(function (global) {
  const STOPWORDS = new Set(
    `a about above after again against all also am an and any are as at be because been
     before being below between both but by can could did do does doing down during each
     even few for from further get got had has have having he her here hers herself him
     himself his how however i if in into is it its itself just like made make many may me
     might more most much must my myself new no nor not now of off on once one only or
     other our ours ourselves out over own said same say says shall she should so some
     still such than that the their theirs them themselves then there these they this
     those through to too two under until up us very was way we well were what when where
     which while who whom why will with would you your yours yourself yourselves`.split(/\s+/)
  );

  const MAX_SENTENCES = 1500; // TextRank compares every pair of sentences, so cap the work.

  // --- 1. Sentences -------------------------------------------------------
  function splitSentences(text) {
    const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });
    const sentences = [];
    for (const para of text.split(/\n+/)) {
      for (const { segment } of segmenter.segment(para)) {
        const s = segment.trim();
        if (s) sentences.push(s);
      }
    }
    return sentences;
  }

  // --- 2. Words -----------------------------------------------------------
  // Very small stemmer: "running"/"runs" -> "run", "studies" -> "study", "boxes" -> "box".
  function stem(word) {
    if (word.length <= 4) return word;
    if (word.endsWith("ies")) return word.slice(0, -3) + "y";
    if (/(ss|x|z|ch|sh)es$/.test(word)) return word.slice(0, -2);
    for (const suffix of ["ingly", "edly", "ing", "ed", "ly"]) {
      if (word.endsWith(suffix) && word.length - suffix.length >= 3) {
        const base = word.slice(0, -suffix.length);
        // "runn" -> "run", "stopp" -> "stop" (but keep "fall", "pass", "buzz")
        return /([^lsz])\1$/.test(base) ? base.slice(0, -1) : base;
      }
    }
    if (word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
    return word;
  }

  // Returns [stem, originalWord] pairs for the meaningful words in a sentence.
  function tokenize(sentence) {
    const words = sentence.toLowerCase().match(/[\p{L}\p{N}']+/gu) || [];
    return words
      .map((w) => w.replace(/'s$|'/g, ""))
      .filter((w) => w.length > 2 && !STOPWORDS.has(w) && !/^\d+$/.test(w))
      .map((w) => [stem(w), w]);
  }

  // --- 3. TF-IDF vectors --------------------------------------------------
  function buildVectors(tokenLists) {
    const n = tokenLists.length;
    const docFreq = new Map();
    for (const tokens of tokenLists) {
      for (const t of new Set(tokens)) docFreq.set(t, (docFreq.get(t) || 0) + 1);
    }
    const idf = (t) => Math.log(n / (1 + docFreq.get(t))) + 1;

    return tokenLists.map((tokens) => {
      const vec = new Map();
      for (const t of tokens) vec.set(t, (vec.get(t) || 0) + 1);
      let norm = 0;
      for (const [t, tf] of vec) {
        const w = tf * idf(t);
        vec.set(t, w);
        norm += w * w;
      }
      return { vec, norm: Math.sqrt(norm) };
    });
  }

  function cosine(a, b) {
    if (!a.norm || !b.norm) return 0;
    const [small, big] = a.vec.size < b.vec.size ? [a, b] : [b, a];
    let dot = 0;
    for (const [t, w] of small.vec) {
      const other = big.vec.get(t);
      if (other) dot += w * other;
    }
    return dot / (a.norm * b.norm);
  }

  // --- 4. TextRank --------------------------------------------------------
  function textRank(vectors, { damping = 0.85, iterations = 30 } = {}) {
    const n = vectors.length;
    const sim = Array.from({ length: n }, () => new Float32Array(n));
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const s = cosine(vectors[i], vectors[j]);
        sim[i][j] = sim[j][i] = s;
      }
    }
    const outWeight = sim.map((row) => row.reduce((a, b) => a + b, 0));

    let scores = new Float32Array(n).fill(1);
    for (let it = 0; it < iterations; it++) {
      const next = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        let sum = 0;
        for (let j = 0; j < n; j++) {
          if (sim[j][i] && outWeight[j]) sum += (sim[j][i] / outWeight[j]) * scores[j];
        }
        next[i] = 1 - damping + damping * sum;
      }
      scores = next;
    }
    return { scores, sim };
  }

  // --- Main entry point ---------------------------------------------------
  function summarize(text, { title = "", count = 6 } = {}) {
    let sentences = splitSentences(text);
    const totalWords = (text.match(/\S+/g) || []).length;
    const truncated = sentences.length > MAX_SENTENCES;
    if (truncated) sentences = sentences.slice(0, MAX_SENTENCES);

    const stats = {
      words: totalWords,
      sentences: sentences.length,
      readingMinutes: Math.max(1, Math.round(totalWords / 230)),
      truncated,
    };
    if (sentences.length === 0) return { tldr: "", points: [], keywords: [], stats };

    const tokenPairs = sentences.map(tokenize);
    const tokenLists = tokenPairs.map((pairs) => pairs.map(([s]) => s));
    const vectors = buildVectors(tokenLists);
    const { scores: rank, sim } = textRank(vectors);
    const maxRank = Math.max(...rank) || 1;

    // --- 5. Combine signals into one score per sentence ---
    const titleStems = new Set(tokenize(title).map(([s]) => s));
    const n = sentences.length;
    const scored = sentences.map((text, i) => {
      const wordCount = text.split(/\s+/).length;
      let score = rank[i] / maxRank;                       // TextRank: 0..1
      score += 0.2 * (1 - i / n);                          // earlier = slightly better
      if (i < 3) score += 0.1;                             // opening sentences often state the topic
      if (titleStems.size) {
        const hits = tokenLists[i].filter((t) => titleStems.has(t)).length;
        score += 0.3 * Math.min(1, hits / titleStems.size); // mentions the title's topic
      }
      if (wordCount < 6) score *= 0.3;                     // fragments, captions, "Read more."
      else if (wordCount > 45) score *= 0.7;               // run-on sentences are hard to skim
      return { index: i, text, score };
    });

    // --- 6. Pick top sentences, skipping near-duplicates ---
    const ranked = [...scored].sort((a, b) => b.score - a.score);
    const chosen = [];
    for (const cand of ranked) {
      if (chosen.length >= count + 1) break; // +1 because the best one becomes the TL;DR
      if (cand.text.split(/\s+/).length < 6) continue;
      const tooSimilar = chosen.some((c) => sim[c.index][cand.index] > 0.5);
      if (!tooSimilar) chosen.push(cand);
    }

    const [best, ...rest] = chosen;
    const points = rest.sort((a, b) => a.index - b.index).map((c) => c.text);

    return {
      tldr: best ? best.text : "",
      points,
      keywords: topKeywords(tokenPairs, vectors, 8),
      stats,
    };
  }

  // Keywords = words with the highest total TF-IDF weight, shown in their most common form.
  function topKeywords(tokenPairs, vectors, k) {
    const weight = new Map();
    const surface = new Map(); // stem -> { word: count }
    vectors.forEach(({ vec }) => {
      for (const [t, w] of vec) weight.set(t, (weight.get(t) || 0) + w);
    });
    for (const pairs of tokenPairs) {
      for (const [s, w] of pairs) {
        const forms = surface.get(s) || {};
        forms[w] = (forms[w] || 0) + 1;
        surface.set(s, forms);
      }
    }
    return [...weight.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, k)
      .map(([s]) => Object.entries(surface.get(s)).sort((a, b) => b[1] - a[1])[0][0]);
  }

  global.Summarizer = { summarize, splitSentences, tokenize, stem };
})(globalThis);
