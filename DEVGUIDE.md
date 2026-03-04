# YinYang Developer Guide ☯️

> A comprehensive guide for any developer or AI assistant continuing work on this project.

---

## 📖 What Is YinYang?

YinYang is a **Chrome Extension** (Manifest V3) that helps Chinese language learners bridge the gap between formal study (Anki flashcards) and real-world immersion (reading webpages, watching YouTube). It segments Chinese text on webpages, color-codes words by knowledge status, and provides real-time comprehension analytics.

**Target user:** Intermediate Chinese learners (HSK 3+) who want to measure how much of a webpage/video they actually understand.

---

## 🏗 Architecture Overview

```
yinyang/
├── manifest.json          # Chrome Extension Manifest V3 config
├── background.js          # Service worker (minimal — just install log)
├── db.js                  # YinYangDB class — in-memory cache + chrome.storage.local
├── content.js             # Content script — word segmentation, highlighting, stats overlay
├── content.css            # Styling for highlighted words and the UI overlay
├── dashboard.html         # Extension options page (full dashboard UI)
├── dashboard.js           # Dashboard logic — Anki sync, video/playlist analyzer
├── server/
│   ├── server.py          # Flask backend — YouTube transcript fetching via youtube-transcript-api
│   └── requirements.txt   # Python dependencies
├── README.md              # User-facing project readme
├── DEVGUIDE.md            # ← This file
└── issues.md              # Known issues tracker
```

### Data Flow Diagram

```
┌──────────────────────────────────────────────────────────┐
│                     Chrome Browser                        │
│                                                          │
│  ┌─────────┐    chrome.storage.local    ┌─────────────┐  │
│  │  db.js   │◄────────────────────────►│ dashboard.js │  │
│  │ (cache)  │   (yy_word → 0/1/2/3)   │             │  │
│  └────┬─────┘                          └──────┬──────┘  │
│       │                                       │          │
│       ▼                                       │          │
│  ┌──────────┐                                 │          │
│  │content.js│  Intl.Segmenter('zh-CN')       │          │
│  │ overlay  │  word segmentation              │          │
│  └──────────┘                                 │          │
│                                               ▼          │
│                                     ┌────────────────┐   │
│                                     │ AnkiConnect    │   │
│                                     │ localhost:8765 │   │
│                                     └────────────────┘   │
└──────────────┬───────────────────────────────────────────┘
               │ HTTP POST
               ▼
      ┌─────────────────┐
      │  server.py       │
      │  localhost:5000   │
      │  (Flask)          │
      │  youtube-transcript│
      │  -api + yt-dlp    │
      └─────────────────┘
```

---

## 📁 File-by-File Breakdown

### `manifest.json`
- **Manifest V3** Chrome Extension
- Content scripts inject `db.js` + `content.js` + `content.css` on **all URLs** (`<all_urls>`)
- `all_frames: true` — works inside iframes (important for some video players)
- Host permissions for AnkiConnect (`127.0.0.1:8765`) and the transcript server (`127.0.0.1:5000`)
- Options page → `dashboard.html`

### `db.js` — Database Layer
- **`YinYangDB` class** attached to `window.yinyangDB`
- Uses `chrome.storage.local` as the persistent store
- All word keys are prefixed with `yy_` (e.g., `yy_你好` → `2`)
- **In-memory cache** (`Map`) for fast synchronous lookups during text processing
- Listens for `chrome.storage.onChanged` to sync across tabs
- Dispatches `yinyang-word-updated` custom events for the content script UI to react

#### Word Status Codes
| Code | Meaning   | Visual                          |
|------|-----------|---------------------------------|
| `0`  | Unknown   | Red highlight                   |
| `1`  | Learning  | Yellow highlight                |
| `2`  | Known     | Transparent (invisible)         |
| `3`  | Ignored   | Faded, excluded from stats      |

### `content.js` — Core Content Script
This is the heart of the extension. Key responsibilities:

1. **Word Segmentation** — Uses `Intl.Segmenter('zh-CN', { granularity: 'word' })` to split Chinese text into individual words. No external dictionary needed.

2. **DOM Parsing** — Walks the DOM tree finding text nodes, wraps each Chinese word in a `<span class="yinyang-word">` with the appropriate status class.

3. **YouTube-Specific Filtering** — On YouTube, it **only** processes:
   - Native YouTube captions (`.ytp-caption-segment`)
   - asbplayer subtitle containers (any parent with "asbplayer" in className)
   - This prevents stats pollution from video titles, comments, sidebar, etc.

4. **Stats Overlay** — Renders a draggable Shadow DOM panel ("YinYang Focus") showing real-time comprehension stats.

5. **Occurrence-Based Counting** — Stats are calculated by counting every word occurrence (not unique words). This matches the dashboard analyzer and gives a more accurate comprehension percentage. Common words like 的, 是, 我 repeat frequently, so occurrence-based counting reflects actual listening/reading comprehension.

6. **MutationObserver** — Watches for dynamically added content (crucial for asbplayer subtitles that appear and disappear as the video plays). Debounced at 50ms.

7. **Hover Hotkeys** — `Shift + 0/1/2/3` while hovering over a word changes its status.

#### Important Implementation Details

- **Double-injection guard**: `window.__yinyangLoaded` prevents the script from running twice if the extension is reloaded
- **Chunk processing**: Text nodes are processed in batches of 100 via `requestAnimationFrame` to avoid blocking the main thread
- **Stats reset on YouTube navigation**: Listens for `yt-navigate-finish` to reset counters when user navigates to a different video
- **Ignored words excluded**: `effectiveTotal = totalOccurrences - ignoredOccurrences` ensures ignored words don't skew comprehension percentages

### `content.css` — Word Highlighting Styles
- Status-based background colors (red, yellow, transparent, faded)
- Hover outline effect
- Fixed-position Shadow DOM host for the stats overlay (`z-index: 2147483647` — max)

### `dashboard.html` + `dashboard.js` — Extension Dashboard
The dashboard is the extension's options page with three main sections:

1. **Vocabulary Stats** — Total counts of known, learning, unknown words in the database
2. **AnkiConnect Sync** — Pull studied cards from a local Anki installation:
   - Queries for non-new cards (`is:review OR is:learn OR prop:reps>0`)
   - Extracts Chinese characters from specified field (or auto-detects)
   - Marks extracted words as "Known" (status 2)
3. **YouTube Video Analyzer** — Paste a single video URL:
   - Fetches transcript via the Flask server
   - Segments and scores against your vocabulary
   - Shows known/learning/new percentages and difficulty rating
4. **Playlist Analyzer** — Paste a playlist URL:
   - Uses SSE (Server-Sent Events) for live progress streaming
   - Scores each video and ranks by comprehension (highest first)
   - Anti-blocking: random delays between transcript requests

#### Comprehension Scoring Formula (both content.js and dashboard.js)
```
effectiveTotal = totalWordOccurrences - ignoredOccurrences
knownPct  = round(knownOccurrences  / effectiveTotal * 100)
learningPct = round(learningOccurrences / effectiveTotal * 100)
newPct    = round(newOccurrences     / effectiveTotal * 100)
```

#### Difficulty Thresholds
| Known %   | Label                    |
|-----------|--------------------------|
| ≥ 95%     | Too Easy                 |
| 85–94%    | Comfortable (i+1) ✅     |
| 70–84%    | Challenging              |
| < 70%     | Too Hard                 |

> The "i+1" label references Krashen's Input Hypothesis — content just slightly above the learner's level is ideal for acquisition.

### `server/server.py` — Flask Transcript Server
- **`/api/transcript`** (POST) — Fetches Chinese transcript for a single video
  - Tries manually-created subtitles first, falls back to auto-generated
  - Language codes tried: `zh`, `zh-Hans`, `zh-CN`, `zh-Hant`, `zh-TW`
  - Strips `[bracketed]` annotations and normalizes whitespace
- **`/api/playlist`** (POST) — SSE stream for playlist analysis
  - Uses `yt-dlp` to extract video IDs (avoids YouTube API quota)
  - Random delays: 3–6s between each video, extra 8–12s cooldown every 5 videos
  - Caps at 50 videos per request
- **`/api/health`** (GET) — Simple health check

---

## 🔧 Development Setup

### Prerequisites
- **Chrome** (or Chromium-based browser)
- **Python 3.9+** (for the transcript server)
- **Anki** with AnkiConnect add-on (optional, for vocabulary sync)
- **asbplayer** Chrome extension (optional, for enhanced video subtitle support)

### Install & Run

```bash
# 1. Clone the repo
git clone https://github.com/vellvient/YinYang.git
cd YinYang

# 2. Install Python dependencies for the server
cd server
pip install -r requirements.txt

# 3. Start the transcript server
python server.py
# → Runs on http://127.0.0.1:5000

# 4. Load the Chrome extension
#    - Go to chrome://extensions
#    - Enable "Developer mode"
#    - Click "Load unpacked" → select the YinYang root folder
#    - The extension icon should appear in Chrome toolbar
```

### Testing Changes
- After editing `content.js`, `db.js`, or `content.css`: refresh the target webpage
- After editing `dashboard.html` or `dashboard.js`: close and reopen the dashboard page
- After editing `manifest.json`: click the reload button on `chrome://extensions`
- After editing `server.py`: restart the Flask server

---

## ⚠️ Known Issues & Gotchas

1. **YouTube native captions are incomplete** — YouTube's built-in subtitle DOM only renders the currently visible line. YinYang's MutationObserver catches these as they appear, but you can only get stats for text that has been displayed so far. This is why asbplayer is the preferred solution.

2. **asbplayer container detection** — The content script checks up to 5 DOM levels for a parent with "asbplayer" in its className. If asbplayer changes its DOM structure, this may break.

3. **Intl.Segmenter word boundaries** — The browser's Chinese word segmenter is decent but not perfect. It may occasionally split compound words differently than expected (e.g., 飞机 might be treated as one or two segments depending on context).

4. **No export/import** — There's currently no way to export your vocabulary database as a file or import from one.

5. **Server must be running** — The YouTube Video Analyzer and Playlist Analyzer features require the Flask server at `localhost:5000` to be running.

---

## 🧠 Key Design Decisions

1. **Occurrence-based stats** (not unique words) — Both the content script overlay and the dashboard use the same formula: counting every word occurrence. This reflects actual comprehension better because high-frequency known words (的, 是, 我, etc.) naturally inflate the "known" percentage, which mirrors real listening/reading experience.

2. **Shadow DOM for overlay** — The stats panel uses Shadow DOM to prevent host page CSS from interfering with the extension's UI.

3. **`chrome.storage.local`** over IndexedDB — Simpler API, automatic cross-tab sync via `onChanged`, and sufficient for the expected data size (thousands of words, not millions).

4. **No YouTube API key** — Uses `yt-dlp` for playlist extraction and `youtube-transcript-api` for subtitles to avoid requiring users to set up API credentials.

5. **Client-side segmentation** — `Intl.Segmenter` runs in the browser, so no Chinese dictionary needs to be bundled or downloaded. The trade-off is slightly less accurate segmentation compared to specialized libraries like jieba.

---

## 🔑 Important Code Patterns

### Adding a new word status
If you ever need a new status (e.g., `4 = Mastered`):
1. Add CSS class in `content.css` (`.yinyang-word-4`)
2. Update the class removal list in `content.js` event handler (`yinyang-word-updated`)
3. Add option in `dashboard.js` `renderTable()` select element
4. Update `dashboard.html` stats boxes if needed

### Adding a new dashboard section
1. Add HTML in `dashboard.html` (inside `.container`)
2. Add logic in `dashboard.js`
3. The `allWords` Map in `dashboard.js` is the source of truth for vocab data on the dashboard page
4. Use `chrome.storage.local` for any new persistent data (prefix keys to avoid collisions)

### Modifying YouTube parsing behavior
- `isNodeValidForParsing()` in `content.js` controls which DOM nodes get processed on YouTube
- To support a new subtitle extension, add a check for its container classname/selector
- The MutationObserver config is at the bottom of `main()`, observing `childList`, `subtree`, and `characterData`

---

## 📊 Changelog

### v1.1 — Stats Consistency Fix (2026-03-04)
- **Fixed**: Content script (YinYang Focus overlay) and dashboard analyzer now use the same occurrence-based counting method. Previously, the overlay counted unique words while the dashboard counted all occurrences, causing the same video to show wildly different comprehension percentages (e.g., 32% vs 61%).
- **Added**: Ignored word exclusion in the content script stats calculation (`effectiveTotal = totalOccurrences - ignoredOccurrences`).
- **Added**: When a word's status changes, occurrence counters now correctly adjust by the number of instances on the page (not just ±1).

### v1.0 — Playlist Comprehension Analyzer
- Added playlist analysis with SSE streaming progress
- Added anti-blocking delays for YouTube transcript fetching
- Added per-video comprehension ranking

### v0.9 — YouTube Video Analyzer
- Added single video transcript analysis
- Flask server for YouTube transcript fetching
- Difficulty rating based on Krashen's i+1 theory

### v0.8 — Core Extension
- Real-time Chinese word segmentation on all webpages
- AnkiConnect sync for vocabulary bootstrapping
- asbplayer subtitle integration for YouTube
- Cross-tab vocabulary sync via chrome.storage

---

*Last updated: 2026-03-04*
