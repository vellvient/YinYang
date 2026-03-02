// db.js
class YinYangDB {
    constructor() {
        this.cache = new Map();
        this.listenForChanges();
    }

    async init() {
        return new Promise((resolve, reject) => {
            chrome.storage.local.get(null, (items) => {
                if (chrome.runtime.lastError) {
                    return reject(chrome.runtime.lastError);
                }
                for (const [key, value] of Object.entries(items)) {
                    if (key.startsWith('yy_')) {
                        const word = key.substring(3);
                        this.cache.set(word, value);
                    }
                }
                resolve();
            });
        });
    }

    listenForChanges() {
        chrome.storage.onChanged.addListener((changes, namespace) => {
            if (namespace === 'local') {
                let hasChanges = false;
                for (const [key, { oldValue, newValue }] of Object.entries(changes)) {
                    if (key.startsWith('yy_')) {
                        const word = key.substring(3);
                        this.cache.set(word, newValue);

                        // Dispatch event for content UI to update
                        document.dispatchEvent(new CustomEvent('yinyang-word-updated', {
                            detail: { word, status: newValue, oldStatus: oldValue }
                        }));
                        hasChanges = true;
                    }
                }
            }
        });
    }

    getWordStatus(word) {
        return this.cache.get(word); // Returns undefined if not found, else 0-3
    }

    async updateWordStatus(word, status) {
        this.cache.set(word, status); // Update sync cache first
        return new Promise((resolve, reject) => {
            const key = 'yy_' + word;
            chrome.storage.local.set({ [key]: status }, () => {
                if (chrome.runtime.lastError) {
                    return reject(chrome.runtime.lastError);
                }
                resolve();
            });
        });
    }
}

// Attach to window so content.js can access it
window.yinyangDB = new YinYangDB();
