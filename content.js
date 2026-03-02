// content.js
console.log("YinYang content script loaded");

const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' });

const isYouTube = window.location.hostname.includes('youtube.com');

// State for stats
let totalUniqueWords = new Set();
let knownWords = new Set();
let learningWords = new Set();

// Check if a string contains any Chinese characters
function containsChinese(text) {
    return /[\u4e00-\u9fa5]/.test(text);
}

// Ensure we only parse relevant containers on YouTube to avoid side-video pollution
function isNodeValidForParsing(node) {
    if (!isYouTube) return true;

    const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    if (!el) return false;

    // Allow native youtube captions and video player
    if (el.closest('#movie_player') || el.closest('.html5-video-player')) return true;

    // Allow asbplayer containers
    if (el.closest('[id*="asbplayer"]') || el.closest('[class*="asbplayer"]')) return true;

    return false;
}

// Process a single text node
function processTextNode(node) {
    const text = node.nodeValue;
    if (!text || !containsChinese(text)) return;

    const fragment = document.createDocumentFragment();
    const segments = segmenter.segment(text);

    for (const segment of segments) {
        if (segment.isWordLike && containsChinese(segment.segment)) {
            const span = document.createElement('span');
            span.className = 'yinyang-word';
            span.textContent = segment.segment;
            // Fetch status from DB cache
            const status = window.yinyangDB.getWordStatus(segment.segment) || 0;
            span.classList.add(`yinyang-word-${status}`);
            span.dataset.word = segment.segment;

            // Update stats sets
            totalUniqueWords.add(segment.segment);
            if (status === 2) knownWords.add(segment.segment);
            if (status === 1) learningWords.add(segment.segment);

            fragment.appendChild(span);
        } else {
            fragment.appendChild(document.createTextNode(segment.segment));
        }
    }

    // Replace text node with the fragment
    if (node.parentNode) {
        node.parentNode.replaceChild(fragment, node);
    }
}

// Traverse DOM and find text nodes
function parseDOM(rootNode = document.body) {
    const walker = document.createTreeWalker(
        rootNode,
        NodeFilter.SHOW_TEXT,
        {
            acceptNode: function (node) {
                // Skip script, style, noscript
                const parentTag = node.parentNode ? node.parentNode.tagName.toLowerCase() : '';
                if (['script', 'style', 'noscript'].includes(parentTag)) {
                    return NodeFilter.FILTER_REJECT;
                }
                // Skip nodes we already wrapped to prevent double-wrapping
                if (node.parentNode && node.parentNode.classList && node.parentNode.classList.contains('yinyang-word')) {
                    return NodeFilter.FILTER_REJECT;
                }
                // Skip shadow root UI 
                if (node.parentNode && node.parentNode.closest && node.parentNode.closest('#yinyang-ui-root')) {
                    return NodeFilter.FILTER_REJECT;
                }
                if (!isNodeValidForParsing(node)) {
                    return NodeFilter.FILTER_REJECT;
                }
                if (!node.nodeValue.trim()) {
                    return NodeFilter.FILTER_REJECT;
                }
                return NodeFilter.FILTER_ACCEPT;
            }
        }
    );

    const textNodes = [];
    let node;
    while ((node = walker.nextNode())) {
        textNodes.push(node);
    }

    // Process nodes in chunks to avoid blocking the main thread
    processInChunks(textNodes);
}

function processInChunks(nodes, chunkSize = 100) {
    let index = 0;

    function doChunk() {
        const end = Math.min(index + chunkSize, nodes.length);
        for (let i = index; i < end; i++) {
            if (nodes[i] && nodes[i].parentNode) {
                processTextNode(nodes[i]);
            }
        }
        index = end;
        if (index < nodes.length) {
            requestAnimationFrame(doChunk);
        } else {
            console.log("YinYang text processing complete.");
            // Trigger UI update event here
            document.dispatchEvent(new CustomEvent('yinyang-update-stats'));
        }
    }

    if (nodes.length > 0) {
        requestAnimationFrame(doChunk);
    }
}

// Hover state
let hoveredWordElement = null;

// Add generic mouse listener to track hover
document.addEventListener('mouseover', (e) => {
    if (e.target && e.target.classList.contains('yinyang-word')) {
        hoveredWordElement = e.target;
    }
});

document.addEventListener('mouseout', (e) => {
    if (e.target === hoveredWordElement) {
        hoveredWordElement = null;
    }
});

// Keypress listener
document.addEventListener('keydown', async (e) => {
    if (!hoveredWordElement) return;

    // Require Shift + Number to prevent interfering with YouTube/video players
    const validCodes = ['Digit0', 'Digit1', 'Digit2', 'Digit3'];
    if (e.shiftKey && validCodes.includes(e.code)) {
        e.preventDefault();
        e.stopPropagation();
        const status = parseInt(e.code.replace('Digit', ''), 10);
        const word = hoveredWordElement.dataset.word;

        // Update DB (this will trigger the onChange listener naturally across tabs)
        await window.yinyangDB.updateWordStatus(word, status);
    }
});

// Listen for updates from other tabs or background
document.addEventListener('yinyang-word-updated', (e) => {
    const { word, status, oldStatus } = e.detail;

    // Update all instances of this word on the page
    const spans = document.querySelectorAll(`span.yinyang-word[data-word="${word}"]`);
    spans.forEach(span => {
        span.classList.remove('yinyang-word-0', 'yinyang-word-1', 'yinyang-word-2', 'yinyang-word-3');
        span.classList.add(`yinyang-word-${status}`);
    });

    // Update stats
    if (oldStatus === 2) knownWords.delete(word);
    if (oldStatus === 1) learningWords.delete(word);

    if (status === 2) {
        knownWords.add(word);
    } else if (status === 1) {
        learningWords.add(word);
    }

    updateStatsUI();
});

// UI
let shadowRoot = null;
let statsTextElement = null;

function renderUI() {
    const hostId = 'yinyang-ui-root';
    if (document.getElementById(hostId)) return;

    const host = document.createElement('div');
    host.id = hostId;
    document.body.appendChild(host);

    shadowRoot = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = `
    .yinyang-panel {
      background: rgba(30, 30, 30, 0.9);
      color: #fff;
      padding: 10px 15px;
      border-radius: 8px;
      font-family: system-ui, sans-serif;
      font-size: 14px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      backdrop-filter: blur(4px);
      cursor: grab;
      user-select: none;
      display: flex;
      flex-direction: column;
      gap: 5px;
      pointer-events: auto; /* Re-enable pointer events for the panel */
      border: 1px solid rgba(255,255,255,0.1);
    }
    .yinyang-panel:active {
      cursor: grabbing;
    }
    .stats-row {
      display: flex;
      justify-content: space-between;
      gap: 15px;
    }
    .stats-title {
      font-weight: 600;
      color: #bbb;
    }
    .stats-value {
      font-weight: bold;
    }
    .stats-known { color: #4CAF50; }
    .stats-learning { color: #FFEB3B; }
  `;

    const panel = document.createElement('div');
    panel.className = 'yinyang-panel';

    const titleRow = document.createElement('div');
    titleRow.style.display = 'flex';
    titleRow.style.justifyContent = 'space-between';
    titleRow.innerHTML = `<span class="stats-title">YinYang Focus</span><button id="yy-reset-btn" style="background:transparent; border:1px solid rgba(255,255,255,0.2); color:#bbb; border-radius:4px; font-size:10px; cursor:pointer; padding:2px 5px;">Reset</button>`;

    const contentRow = document.createElement('div');
    contentRow.className = 'stats-row';

    statsTextElement = document.createElement('div');
    statsTextElement.innerHTML = `Scanning...`;

    contentRow.appendChild(statsTextElement);
    panel.appendChild(titleRow);
    panel.appendChild(contentRow);

    shadowRoot.appendChild(style);
    shadowRoot.appendChild(panel);

    // Reset logic
    panel.querySelector('#yy-reset-btn').addEventListener('click', () => {
        totalUniqueWords.clear();
        knownWords.clear();
        learningWords.clear();
        updateStatsUI();
    });

    // Drag logic
    let isDragging = false;
    let offsetX = 0;
    let offsetY = 0;

    panel.addEventListener('mousedown', (e) => {
        isDragging = true;
        const rect = host.getBoundingClientRect();
        offsetX = e.clientX - rect.left;
        offsetY = e.clientY - rect.top;
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        host.style.left = (e.clientX - offsetX) + 'px';
        host.style.top = (e.clientY - offsetY) + 'px';
        host.style.right = 'auto'; // Disable right anchoring once dragged
    });

    document.addEventListener('mouseup', () => {
        isDragging = false;
    });
}

function updateStatsUI() {
    if (!statsTextElement) return;

    const total = totalUniqueWords.size;
    if (total === 0) {
        statsTextElement.innerHTML = `Scanning...`;
        return;
    }

    const known = knownWords.size;
    const learning = learningWords.size;

    const knownPercent = Math.round((known / total) * 100);
    const learningPercent = Math.round((learning / total) * 100);

    statsTextElement.innerHTML = `
    Known: <span class="stats-value stats-known">${knownPercent}%</span> 
    (<span class="stats-value stats-known">${known}</span>) | 
    Learning: <span class="stats-value stats-learning">${learningPercent}%</span>
    (<span class="stats-value stats-learning">${learning}</span>)
  `;
}

document.addEventListener('yinyang-update-stats', () => {
    updateStatsUI();
});


// asbplayer / Dynamic content observer
let observerTimeout = null;
const addedNodesToProcess = new Set();

const dynamicObserver = new MutationObserver((mutations) => {
    let hasValidMutations = false;

    for (const mutation of mutations) {
        if (mutation.type === 'childList') {
            for (const node of mutation.addedNodes) {
                // Skip nodes we inject to prevent infinite loops
                if (node.id === 'yinyang-ui-root') continue;
                if (!isNodeValidForParsing(node)) continue;

                if (node.nodeType === Node.ELEMENT_NODE) {
                    if (node.classList && node.classList.contains('yinyang-word')) continue;
                    addedNodesToProcess.add(node);
                    hasValidMutations = true;
                } else if (node.nodeType === Node.TEXT_NODE && node.nodeValue.trim()) {
                    if (node.parentNode && node.parentNode.classList && node.parentNode.classList.contains('yinyang-word')) continue;
                    addedNodesToProcess.add(node);
                    hasValidMutations = true;
                }
            }
        } else if (mutation.type === 'characterData') {
            if (!isNodeValidForParsing(mutation.target)) continue;
            if (mutation.target.parentNode && !mutation.target.parentNode.classList.contains('yinyang-word')) {
                addedNodesToProcess.add(mutation.target);
                hasValidMutations = true;
            }
        }
    }

    if (hasValidMutations) {
        if (observerTimeout) clearTimeout(observerTimeout);
        // Debounce processing to chunk updates together
        observerTimeout = setTimeout(() => {
            processAddedNodes();
        }, 50);
    }
});

function processAddedNodes() {
    const nodes = Array.from(addedNodesToProcess);
    addedNodesToProcess.clear();

    const textNodes = [];
    for (const node of nodes) {
        if (node.nodeType === Node.TEXT_NODE) {
            textNodes.push(node);
        } else {
            // Traverse added element for text nodes
            const walker = document.createTreeWalker(
                node,
                NodeFilter.SHOW_TEXT,
                {
                    acceptNode: function (n) {
                        const parentTag = n.parentNode ? n.parentNode.tagName.toLowerCase() : '';
                        if (['script', 'style', 'noscript'].includes(parentTag)) return NodeFilter.FILTER_REJECT;
                        if (n.parentNode && n.parentNode.classList && n.parentNode.classList.contains('yinyang-word')) return NodeFilter.FILTER_REJECT;
                        if (n.parentNode && n.parentNode.closest && n.parentNode.closest('#yinyang-ui-root')) return NodeFilter.FILTER_REJECT;
                        if (!isNodeValidForParsing(n)) return NodeFilter.FILTER_REJECT;
                        if (!n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
                        return NodeFilter.FILTER_ACCEPT;
                    }
                }
            );
            let n;
            while ((n = walker.nextNode())) {
                textNodes.push(n);
            }
        }
    }

    if (textNodes.length > 0) {
        processInChunks(textNodes);
    }
}

async function main() {
    await window.yinyangDB.init();
    console.log("YinYang DB initialized, cache loaded with " + window.yinyangDB.cache.size + " words");

    renderUI();

    // Reset stats when YouTube changes videos
    document.addEventListener('yt-navigate-finish', () => {
        totalUniqueWords.clear();
        knownWords.clear();
        learningWords.clear();
        updateStatsUI();
    });

    // Start parsing
    parseDOM(document.body);

    // Start observing for dynamically added elements (like asbplayer subtitles)
    dynamicObserver.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true
    });
}

// Run
main();
