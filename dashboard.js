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
        // Find studied cards (-is:new) in the deck
        const query = `"deck:${deckName}" -is:due`;
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
                // If the user specified a field, extract Chinese from it cleanly.
                const val = card.fields[fieldName].value.replace(/<[^>]*>?/gm, '').trim();
                const words = val.match(/[\u4e00-\u9fa5]+/g);
                if (words) {
                    words.forEach(w => ankiWords.add(w));
                }
            } else {
                // Fallback: search all fields but strictly require it to be short, pure Chinese.
                for (let field in card.fields) {
                    const rawVal = card.fields[field].value.replace(/<[^>]*>?/gm, '').trim();
                    if (/^[\u4e00-\u9fa5]{1,6}$/.test(rawVal)) {
                        ankiWords.add(rawVal);
                        // Break if we find a likely candidate to prevent polling definitions
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
