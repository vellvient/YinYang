# YinYang Extension Documentation

## Overview
YinYang is a lightweight, highly optimized Chrome Extension designed to help you learn Chinese (HSK 3 focus). It parses Chinese text on any webpage, highlights words based on your knowledge status (Unknown, Learning, Known, Ignored), and tracks your reading comprehension stats. It also features a real-time integration with `asbplayer` for dynamic subtitle highlighting and an `AnkiConnect` dashboard to sync your vocabulary.

## Architecture & Core Files

### 1. `manifest.json`
The configuration file for the Chrome Extension. It requests necessary permissions:
- `storage`: For `chrome.storage.local` to permanently save your vocabulary.
- `activeTab` / `scripting`: To interact with the web pages you visit.
- `host_permissions` (`<all_urls>`, `http://127.0.0.1:8765/`): Allows injecting the content script on all sites and cross-origin requests to your local Anki application.
- `options_page`: Declares `dashboard.html` as the extension's options page.

### 2. `db.js`
The database engine for the extension, injected into pages before the content script.
- **`window.yinyangDB`**: A globally attached class instance.
- **Cache Map**: Uses an in-memory `Map()` to synchronously return word statuses to the text parser. Without this, awaiting a database lookup 1000 times during page-load would lag the browser.
- **Storage Backend**: Modifies `chrome.storage.local` using a `yy_[word]` prefix.
- **Real-time Syncing**: Listens to `chrome.storage.onChanged`. If you change a word's status in one tab (or the dashboard), other tabs will instantly receive a `yinyang-word-updated` event.

### 3. `content.js`
The heavy-lifter. It executes directly on the websites you visit.
- **Parser (`Intl.Segmenter`)**: The native browser API that segments raw Chinese sentences into logical words without needing heavy external dictionaries.
- **DOM Traverser (`TreeWalker`)**: Efficiently seeks out raw text nodes on the page, ignoring `script`, `style`, and the extension's own UI elements.
- **Chunked Rendering**: Replaces plain text with highlighted `<span class="yinyang-word">` items. It processes large articles in batches using `requestAnimationFrame` to ensure smooth 60fps scrolling.
- **Stats UI (Shadow DOM)**: Injects an isolated, draggable UI overlay to display your Known vs. Learning percentage. The Shadow Root prevents the site's CSS from corrupting the widget.
- **Keyboard Shortcuts**: Listens for `Shift + 0/1/2/3` when your mouse hovers over a word to update its status.
- **Dynamic Observer**: A `MutationObserver` that watches the page for new elements being added (specifically useful for subtitles popping up in `asbplayer` or YouTube).

### 4. `content.css`
Contains minimal definitions for `.yinyang-word` elements. 
- *Unknown (0)*: Faint red dashed underline / red background.
- *Learning (1)*: Yellow background.
- *Known (2)*: Transparent.
- *Ignored (3)*: Faded opacity.

### 5. `dashboard.js` & `dashboard.html`
Your control center. When you click "Options" on the extension, it opens this local page.
- **Stats & Table**: Displays an editable list of your vocabulary retrieved from `chrome.storage.local`.
- **AnkiConnect Integration**: Uses standard `XMLHttpRequest` to ping `http://127.0.0.1:8765/`. It asks Anki to find cards in your specified deck (`-is:new`), extracts the Chinese words cleanly, and marks them as "Known" (Status 2) in the YinYang database.

---

## Suggested Code Improvements (Based on Best Practices & JitenReader)

As the project scales, there are several architectural improvements we can adapt, drawing inspiration from tools like JitenReader:

### 1. Shift to a Background Service Worker (Message Passing)
**Current State:** 
`db.js` and `content.js` talk directly to `chrome.storage` from inside the webpage.
**Improvement:** 
Move the heavy lifting to `background.js` (the Service Worker). The content script should just be a dumb "renderer". 
- When `content.js` finds a word, it should use `chrome.runtime.sendMessage` to ask the background script "What is the status of this word?". 
- This reduces the memory footprint injected into every single website you visit, exactly how JitenReader relies on a robust background worker handling data fetching and dictionary lookups.

### 2. A Dedicated UI Framework (Preact/React/Vue) vs Vanilla DOM
**Current State:** 
We manually construct the Shadow DOM widget using `document.createElement` strings.
**Improvement:** 
JitenReader and similar apps use minimal build tools (like Vite + Preact) to render their overlays. If you plan to add more features to the "YinYang Focus" widget (like clicking a word to see its translation/pinyin), handling complex UI states in vanilla JS gets messy quickly. 

### 3. User Settings & Configuration State
**Current State:** 
Colors (Red/Yellow) and Shortcuts (`Shift + 1`) are hardcoded into `content.css` and `content.js`.
**Improvement:**
Implement a Settings store in `chrome.storage.local` (e.g., `{ config: { hotkeys: {...}, colors: {...} } }`). The `dashboard.html` should let you customize the colors and keyboard shortcuts, rather than needing to edit the source code.

### 4. Optimize the MutationObserver
**Current State:** 
The `MutationObserver` watches the *entire* `document.body` for added child nodes to catch `asbplayer`.
**Improvement:** 
This is slightly expensive. We should try to detect if `asbplayer` or YouTube is active, and only bind the observer to the specific video container div (`.html5-video-player` for YT, or the specific asbplayer overlay).

### 5. Dictionary & Tooltip Support
Since you are using `Intl.Segmenter`, you have great segmentation but zero definitions. You could integrate a lightweight JSON dictionary (like CC-CEDICT) or hook into Yomitan/JitenReader's API to show a tooltip with Pinyin and English definitions when you hover over a word!
