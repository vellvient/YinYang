
---

# ☯️ YinYang: Smart Chinese Reading Companion

**YinYang** is a specialized Chrome Extension designed to bridge the gap between formal study and immersion. Optimized for **HSK 3 and above**, it provides seamless vocabulary tracking and real-time comprehension analysis directly on any webpage.

---

## 🚀 Core Functionality

### 1. Real-time Reading Assistance

* **Intelligent Word Segmentation**: Leveraging the browser's native `Intl.Segmenter` for lightweight, accurate sentence breakdown without bulky external dictionaries.
* **Knowledge-Based Highlighting**: Words are visually color-coded based on your personal mastery:
* 🔴 **Unknown**: New words awaiting your discovery.
* 🟡 **Learning**: Words currently in your active study rotation.
* ⚪ **Known**: Mastered words (rendered transparently to reduce clutter).
* 🔘 **Ignored**: Faded particles or names you don't wish to track.


* **Comprehension Analytics**: A discreet, draggable Shadow DOM overlay provides a real-time **Comprehension Score**, showing the percentage of known vs. unknown text on your current page.

### 2. Interactive Learning & Sync

* **Hover Hotkeys**: Update word status instantly without clicking. Simply hover and press `Shift + 0/1/2/3`.
* **State Persistence**: Cross-tab synchronization ensures that marking a word as "Known" in one tab updates your experience across all open pages and your dashboard immediately.

### 3. Video Integration (`asbplayer` & YouTube)

* **Dynamic Subtitles**: Applies segmentation and highlighting logic to video subtitles in real-time.
* **Manual Trigger**: Use `Ctrl + Shift + F` to force subtitle analysis in environments utilizing `asbplayer`.

### 4. Anki Ecosystem Integration

* **AnkiConnect Sync**: Seamlessly pull your "matured" cards from your local Anki database. YinYang automatically marks these as **Known**, ensuring your browsing experience reflects your actual academic progress.
* **Vocabulary Management**: A centralized dashboard to view, sort, and edit your tracked word list and study statistics.

---

## 🛠 Usage Scenarios

| Scenario | Benefit |
| --- | --- |
| **Browsing News** | Instantly identify which articles match your current reading level. |
| **Immersion Watching** | Turn passive YouTube/asbplayer sessions into active learning by tracking subtitle vocabulary. |
| **Bridging the Gap** | Connect your formal SRS study (Anki) with informal web browsing to eliminate redundant lookups. |

---

## ⌨️ Shortcuts

| Key | Action |
| --- | --- |
| `Shift + 0/1/2/3` | Change word status (Hover mode) |
| `Ctrl + Shift + F` | Trigger `asbplayer` subtitle analysis |

---
