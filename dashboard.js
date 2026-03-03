// dashboard.js

let allWords = new Map();

async function invokeAnki(action, version, params = {}) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.addEventListener('error', () => reject('failed to issue request'));
        xhr.addEventListener('load', () => {
            try {
                const response = JSON.parse(xhr.responseText);
                if (Object.getOwnPropertyNames(response).length != 2) {
                    throw 'response has an unexpected number of fields';
                }
                if (!response.hasOwnProperty('error')) {
                    throw 'response is missing required error field';
                }
                if (!response.hasOwnProperty('result')) {
                    throw 'response is missing required result field';
                }
                if (response.error) {
                    throw response.error;
                }
                resolve(response.result);
            } catch (e) {
                reject(e);
            }
        });

        xhr.open('POST', 'http://127.0.0.1:8765');
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.send(JSON.stringify({ action, version, params }));
    });
}

async function checkAnkiConnection() {
    const statusEl = document.getElementById('connection-status');
    const syncBtn = document.getElementById('sync-btn');
    try {
        const version = await invokeAnki('version', 6);
        statusEl.textContent = `Connected (AnkiConnect v${version})`;
        statusEl.className = 'connected';
        syncBtn.disabled = false;
    } catch (e) {
        statusEl.textContent = 'Disconnected (Is Anki open?)';
        statusEl.className = 'disconnected';
        syncBtn.disabled = true;
    }
}

function loadWords() {
    chrome.storage.local.get(null, (items) => {
        allWords.clear();
        let counts = { 0: 0, 1: 0, 2: 0, 3: 0 };

        for (const [key, value] of Object.entries(items)) {
            if (key.startsWith('yy_')) {
                const word = key.substring(3);
                allWords.set(word, value);
                counts[value]++;
            }
        }

        // Update stats
        document.getElementById('count-known').textContent = counts[2] || 0;
        document.getElementById('count-learning').textContent = counts[1] || 0;
        document.getElementById('count-unknown').textContent = counts[0] || 0;

        renderTable();
    });
}

function renderTable() {
    const tbody = document.getElementById('word-table-body');
    tbody.innerHTML = '';

    // Sort words: learning first, then known, then unknown, then ignored
    const sortedWords = Array.from(allWords.entries()).sort((a, b) => {
        const order = { 1: 0, 2: 1, 0: 2, 3: 3 };
        return order[a[1]] - order[b[1]];
    });

    for (const [word, status] of sortedWords) {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="font-size: 18px;">${word}</td>
            <td><span class="status-badge status-${status} status-text-${status}"></span></td>
            <td>
                <select class="status-select" data-word="${word}">
                    <option value="0" ${status === 0 ? 'selected' : ''}>Unknown</option>
                    <option value="1" ${status === 1 ? 'selected' : ''}>Learning</option>
                    <option value="2" ${status === 2 ? 'selected' : ''}>Known</option>
                    <option value="3" ${status === 3 ? 'selected' : ''}>Ignored</option>
                </select>
            </td>
        `;
        tbody.appendChild(tr);
    }

    // Bind listeners
    document.querySelectorAll('.status-select').forEach(select => {
        select.addEventListener('change', (e) => {
            const word = e.target.dataset.word;
            const newStatus = parseInt(e.target.value, 10);
            updateWordStatus(word, newStatus);
        });
    });
}

function updateWordStatus(word, status) {
    const key = 'yy_' + word;
    chrome.storage.local.set({ [key]: status }, () => {
        loadWords(); // reload table
    });
}

document.getElementById('sync-btn').addEventListener('click', async () => {
    const deckName = document.getElementById('deck-name').value;
    const fieldName = document.getElementById('field-name').value.trim();
    if (!deckName) {
        alert("Enter a deck name");
        return;
    }

    document.getElementById('sync-btn').disabled = true;
    document.getElementById('sync-btn').textContent = "Syncing...";

    try {
        // Find studied cards in the deck
        // "is:review or is:learn" means cards you have seen. "prop:reps>0" means cards answered at least once.
        const query = `"deck:${deckName}" (is:review OR is:learn OR prop:reps>0)`;
        const cardIds = await invokeAnki('findCards', 6, { query: query });
        if (cardIds.length === 0) {
            alert(`No studied cards found in ${deckName}`);
            return;
        }

        // Get card contents
        const cards = await invokeAnki('cardsInfo', 6, { cards: cardIds });

        let ankiWords = new Set();
        cards.forEach(card => {
            if (fieldName && card.fields[fieldName]) {
                // If the user specified a field, extract Chinese from it.
                const val = card.fields[fieldName].value.replace(/<[^>]*>?/gm, '').trim();
                // Match English letters, Japanese, etc. and strip them, or just match Chinese characters:
                const words = val.match(/[\u4e00-\u9fa5]+/g);
                if (words) {
                    words.forEach(w => ankiWords.add(w));
                }
            } else {
                // Fallback: search all fields for short Chinese strings.
                for (let field in card.fields) {
                    const rawVal = card.fields[field].value.replace(/<[^>]*>?/gm, '').trim();
                    // Just purely Chinese, 1 to 8 characters max
                    if (/^[\u4e00-\u9fa5]{1,8}$/.test(rawVal)) {
                        ankiWords.add(rawVal);
                        break;
                    }
                }
            }
        });

        let syncedCount = 0;
        let updatePromises = [];
        for (const word of ankiWords) {
            if (allWords.get(word) !== 2) {
                const key = 'yy_' + word;
                updatePromises.push(new Promise((resolve) => {
                    chrome.storage.local.set({ [key]: 2 }, resolve);
                }));
                allWords.set(word, 2); // Avoid duplicate counting
                syncedCount++;
            }
        }

        await Promise.all(updatePromises);

        alert(`Sync complete! Pulled ${syncedCount} new known words from Anki.`);
        loadWords();
    } catch (e) {
        alert("Anki Sync Error: " + e);
    } finally {
        checkAnkiConnection(); // resets button
        document.getElementById('sync-btn').textContent = "Sync Studied Words to Anki";
    }
});

// Clear Database Button
document.getElementById('clear-btn').addEventListener('click', () => {
    if (confirm("Are you sure you want to clear ALL your YinYang vocabulary data? This action cannot be undone.")) {
        chrome.storage.local.get(null, (items) => {
            const keysToRemove = Object.keys(items).filter(k => k.startsWith('yy_'));
            chrome.storage.local.remove(keysToRemove, () => {
                alert("Database cleared.");
                loadWords();
            });
        });
    }
});

// Init
checkAnkiConnection();
loadWords();

// Listen for cross-tab changes
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local') {
        loadWords();
    }
});

// YouTube Analyzer Logic
document.getElementById('yt-analyze-btn').addEventListener('click', async () => {
    const url = document.getElementById('yt-url').value.trim();
    if (!url) {
        alert("Please enter a YouTube URL");
        return;
    }

    const btn = document.getElementById('yt-analyze-btn');
    btn.disabled = true;
    btn.textContent = "Analyzing...";

    try {
        const response = await fetch('http://127.0.0.1:5000/api/transcript', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url })
        });

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || 'Failed to fetch transcript');
        }

        const transcript = data.transcript;

        // Use browser segmenter 
        const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' });
        const segments = segmenter.segment(transcript);

        let totalWords = 0;
        let knownCount = 0;
        let learningCount = 0;
        let newCount = 0;
        let newWordsList = new Set();
        let ignoredCount = 0;

        for (const segment of segments) {
            if (segment.isWordLike && /[\u4e00-\u9fa5]/.test(segment.segment)) {
                totalWords++;
                const status = allWords.get(segment.segment) || 0;

                if (status === 2) knownCount++;
                else if (status === 1) learningCount++;
                else if (status === 3) ignoredCount++;
                else {
                    newCount++;
                    newWordsList.add(segment.segment);
                }
            }
        }

        const effectiveTotal = totalWords - ignoredCount;

        const knownPct = effectiveTotal > 0 ? Math.round((knownCount / effectiveTotal) * 100) : 0;
        const learningPct = effectiveTotal > 0 ? Math.round((learningCount / effectiveTotal) * 100) : 0;
        const newPct = effectiveTotal > 0 ? Math.round((newCount / effectiveTotal) * 100) : 0;

        document.getElementById('yt-known-pct').textContent = knownPct + '%';
        document.getElementById('yt-learning-pct').textContent = learningPct + '%';
        document.getElementById('yt-unknown-pct').textContent = newPct + '%';

        let difficultyHtml = "";
        if (knownPct >= 95) {
            difficultyHtml = 'Difficulty: <span style="color: #4CAF50;">Too Easy</span>';
        } else if (knownPct >= 85) {
            difficultyHtml = 'Difficulty: <span style="color: #8BC34A;">Comfortable (i+1) ✅</span>';
        } else if (knownPct >= 70) {
            difficultyHtml = 'Difficulty: <span style="color: #FF9800;">Challenging</span>';
        } else {
            difficultyHtml = 'Difficulty: <span style="color: #F44336;">Too Hard</span>';
        }
        document.getElementById('yt-difficulty').innerHTML = difficultyHtml;

        document.getElementById('yt-new-words').textContent = Array.from(newWordsList).slice(0, 50).join(', ') + (newWordsList.size > 50 ? '...' : '');

        document.getElementById('yt-results').style.display = 'block';

    } catch (e) {
        alert("Error: " + e.message);
    } finally {
        btn.disabled = false;
        btn.textContent = "Analyze Comprehension";
    }
});

// ─── Playlist Analyzer ───────────────────────────────────────────────────────

function scoreTranscript(transcript) {
    const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' });
    const segments = segmenter.segment(transcript);

    let total = 0, known = 0, learning = 0, newCount = 0, ignored = 0;
    const newWords = new Set();

    for (const seg of segments) {
        if (seg.isWordLike && /[\u4e00-\u9fa5]/.test(seg.segment)) {
            total++;
            const status = allWords.get(seg.segment) || 0;
            if (status === 2) known++;
            else if (status === 1) learning++;
            else if (status === 3) ignored++;
            else { newCount++; newWords.add(seg.segment); }
        }
    }

    const effective = total - ignored;
    return {
        knownPct: effective > 0 ? Math.round((known / effective) * 100) : 0,
        learningPct: effective > 0 ? Math.round((learning / effective) * 100) : 0,
        newPct: effective > 0 ? Math.round((newCount / effective) * 100) : 0,
        newWords: Array.from(newWords).slice(0, 30),
        totalWords: effective
    };
}

function difficultyLabel(knownPct) {
    if (knownPct >= 95) return { label: 'Too Easy', color: '#4CAF50' };
    if (knownPct >= 85) return { label: 'Comfortable ✅', color: '#8BC34A' };
    if (knownPct >= 70) return { label: 'Challenging', color: '#FF9800' };
    return { label: 'Too Hard', color: '#F44336' };
}

function addLogLine(text) {
    const log = document.getElementById('pl-live-log');
    log.innerHTML += `<div>${text}</div>`;
    log.scrollTop = log.scrollHeight;
}

document.getElementById('pl-analyze-btn').addEventListener('click', async () => {
    const url = document.getElementById('pl-url').value.trim();
    const limit = parseInt(document.getElementById('pl-limit').value, 10) || 20;

    if (!url) { alert('Please enter a playlist URL'); return; }

    const btn = document.getElementById('pl-analyze-btn');
    btn.disabled = true;
    btn.textContent = 'Analyzing...';

    // Reset UI
    const progressArea = document.getElementById('pl-progress-area');
    const resultsArea = document.getElementById('pl-results-area');
    progressArea.style.display = 'block';
    resultsArea.style.display = 'none';
    document.getElementById('pl-progress-bar').style.width = '0%';
    document.getElementById('pl-status-text').textContent = 'Fetching playlist...';
    document.getElementById('pl-live-log').innerHTML = '';
    document.getElementById('pl-table-body').innerHTML = '';

    const collectedResults = [];

    try {
        const response = await fetch('http://127.0.0.1:5000/api/playlist', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, limit })
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || 'Server error');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop(); // keep incomplete line

            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                let evt;
                try { evt = JSON.parse(line.slice(6)); } catch { continue; }

                if (evt.type === 'error') {
                    throw new Error(evt.message);
                }

                if (evt.type === 'start') {
                    document.getElementById('pl-status-text').textContent =
                        `Found ${evt.total} videos in "${evt.playlist_title}"`;
                    addLogLine(`📋 Playlist: ${evt.playlist_title} (${evt.total} videos)`);
                }

                if (evt.type === 'progress') {
                    const pct = Math.round((evt.index / evt.total) * 100);
                    document.getElementById('pl-progress-bar').style.width = pct + '%';
                    document.getElementById('pl-status-text').textContent =
                        `Analyzing ${evt.index + 1} / ${evt.total}: ${evt.title}`;
                    addLogLine(`⏳ [${evt.index + 1}/${evt.total}] ${evt.title}`);
                }

                if (evt.type === 'video_done') {
                    const icon = evt.status === 'ok' ? '✅' : '⚠️ (no subs)';
                    addLogLine(`${icon} ${evt.title}`);
                }

                if (evt.type === 'cooldown') {
                    addLogLine(`☕ Cooldown pause (~${evt.seconds}s) to avoid rate limiting...`);
                }

                if (evt.type === 'done') {
                    document.getElementById('pl-progress-bar').style.width = '100%';
                    document.getElementById('pl-status-text').textContent =
                        `Done! ${evt.total_ok} / ${evt.total} videos had Chinese subtitles.`;

                    // Score each video client-side
                    for (const r of evt.results) {
                        const score = scoreTranscript(r.transcript);
                        collectedResults.push({ ...r, ...score });
                    }

                    // Sort highest comprehension first
                    collectedResults.sort((a, b) => b.knownPct - a.knownPct);

                    // Render table
                    const tbody = document.getElementById('pl-table-body');
                    tbody.innerHTML = '';
                    collectedResults.forEach((r, i) => {
                        const diff = difficultyLabel(r.knownPct);
                        const ytUrl = `https://www.youtube.com/watch?v=${r.video_id}`;
                        const tr = document.createElement('tr');
                        tr.style.background = i % 2 === 0 ? '#fff' : '#f9f9f9';
                        tr.innerHTML = `
                            <td style="padding:10px; border:1px solid #e0e0e0; font-weight:bold; color:#555;">${i + 1}</td>
                            <td style="padding:10px; border:1px solid #e0e0e0;">
                                <a href="${ytUrl}" target="_blank" style="color:#1565C0; text-decoration: none; font-weight: 500;">${r.title}</a>
                                <div style="font-size:11px; color:#999; margin-top:2px;">${r.language} · ${r.totalWords} words</div>
                            </td>
                            <td style="padding:10px; border:1px solid #e0e0e0; text-align:center; font-weight:bold; color:#2e7d32;">${r.knownPct}%</td>
                            <td style="padding:10px; border:1px solid #e0e0e0; text-align:center; color:#c62828;">${r.newPct}%</td>
                            <td style="padding:10px; border:1px solid #e0e0e0; text-align:center; font-weight:bold; color:${diff.color};">${diff.label}</td>
                        `;
                        tbody.appendChild(tr);
                    });

                    document.getElementById('pl-playlist-title').textContent =
                        `Results: ${collectedResults.length} videos ranked by comprehension`;
                    document.getElementById('pl-summary').textContent =
                        `${evt.total - evt.total_ok} videos skipped (no Chinese subtitles).`;
                    resultsArea.style.display = 'block';
                }
            }
        }
    } catch (e) {
        alert('Playlist Error: ' + e.message);
        document.getElementById('pl-status-text').textContent = 'Error: ' + e.message;
    } finally {
        btn.disabled = false;
        btn.textContent = 'Analyze Playlist';
    }
});
