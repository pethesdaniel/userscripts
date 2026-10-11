// ==UserScript==
// @name         Stremio: Set Continue Watching Pointer
// @namespace    com.github.pethesdaniel.stremio-cw-pointer
// @author       Claude
// @version      0.1
// @description  On an episode's detail/streams page, set that episode as the Continue Watching resume point (or mark it "last watched" so the next episode is up).
// @match        https://web.stremio.com/*
// @match        https://app.strem.io/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const API_URL = 'https://api.strem.io/api/datastorePut';
    const BUCKET_KEYS = ['library_recent', 'library'];
    const DETAIL_RE = /#\/detail\/([^/]+)\/([^/?]+)\/([^/?]+)/;

    // ---------- storage helpers ----------

    function readBucket(key) {
        try {
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : null;
        } catch (e) {
            return null;
        }
    }

    function getAuthKey() {
        const profile = readBucket('profile');
        return profile && profile.auth && profile.auth.key ? profile.auth.key : null;
    }

    function findItem(itemId) {
        for (const key of BUCKET_KEYS) {
            const bucket = readBucket(key);
            if (bucket && bucket.items && bucket.items[itemId]) {
                return bucket.items[itemId];
            }
        }
        return null;
    }

    // Write the modified item into every bucket that contains it (or into
    // library_recent as a fallback), then persist.
    function saveItem(item) {
        let saved = false;
        for (const key of BUCKET_KEYS) {
            const bucket = readBucket(key);
            if (bucket && bucket.items && bucket.items[item._id]) {
                bucket.items[item._id] = item;
                localStorage.setItem(key, JSON.stringify(bucket));
                saved = true;
            }
        }
        if (!saved) {
            const bucket = readBucket('library_recent') || { uid: null, items: {} };
            bucket.items[item._id] = item;
            localStorage.setItem('library_recent', JSON.stringify(bucket));
        }
    }

    async function pushToApi(item) {
        const authKey = getAuthKey();
        if (!authKey) return { skipped: true };
        const res = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                collection: 'libraryItem',
                authKey: authKey,
                changes: [item],
            }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || json.error) {
            throw new Error('datastorePut failed: ' + JSON.stringify(json.error || res.status));
        }
        return json;
    }

    // ---------- core mutation (mirrors LibraryItem::advance_to_video) ----------

    function advanceToVideo(item, videoId) {
        const s = item.state;
        s.video_id = videoId;                       // NB: snake_case in JSON, unlike siblings
        s.overallTimeWatched = (s.overallTimeWatched || 0) + (s.timeWatched || 0);
        s.timeWatched = 0;
        s.flaggedWatched = 0;
        s.timeOffset = 1;                           // sentinel: "up next, not started"
        item._mtime = new Date().toISOString();     // newer mtime wins in merge/sync
    }

    function markLastWatched(item, videoId) {
        // "I watched this one" -> CW should offer the NEXT episode.
        const next = nextEpisodeId(videoId);
        if (!next) {
            throw new Error('Cannot derive next episode from video id: ' + videoId);
        }
        advanceToVideo(item, next);
        item.state.lastWatched = new Date().toISOString();
        item.state.timesWatched = (item.state.timesWatched || 0) + 1;
    }

    // Works for Cinemeta-style ids: tt1234567:2:5 -> tt1234567:2:6
    function nextEpisodeId(videoId) {
        const parts = videoId.split(':');
        const last = Number(parts[parts.length - 1]);
        if (parts.length < 2 || !Number.isFinite(last)) return null;
        parts[parts.length - 1] = String(last + 1);
        return parts.join(':');
    }

    // ---------- actions ----------

    async function apply(mode) {
        const m = location.hash.match(DETAIL_RE);
        if (!m) return;
        const itemId = decodeURIComponent(m[2]);
        const videoId = decodeURIComponent(m[3]);

        const item = findItem(itemId);
        if (!item) {
            alert('Stremio CW: "' + itemId + '" is not in your library data yet.\n' +
                  'Play any part of it once (or add it to your library), then retry.');
            return;
        }

        try {
            if (mode === 'resume') {
                advanceToVideo(item, videoId);
            } else {
                markLastWatched(item, videoId);
            }
            saveItem(item);
            const api = await pushToApi(item);
            const synced = api.skipped ? ' (local only — not logged in)' : ' + synced to account';
            toast('Continue Watching updated' + synced + '. Reloading…');
            setTimeout(() => location.reload(), 900);
        } catch (e) {
            alert('Stremio CW error: ' + e.message);
        }
    }

    // ---------- UI ----------

    let panel = null;

    function toast(msg) {
        const t = document.createElement('div');
        t.textContent = msg;
        Object.assign(t.style, {
            position: 'fixed', bottom: '90px', right: '20px', zIndex: 99999,
            background: '#0f0d20', color: '#fff', padding: '10px 14px',
            borderRadius: '8px', font: '13px sans-serif', boxShadow: '0 2px 12px rgba(0,0,0,.5)',
        });
        document.body.appendChild(t);
        setTimeout(() => t.remove(), 3000);
    }

    function button(label, title, handler) {
        const b = document.createElement('button');
        b.textContent = label;
        b.title = title;
        Object.assign(b.style, {
            background: '#7b5bf5', color: '#fff', border: 'none', cursor: 'pointer',
            padding: '8px 12px', borderRadius: '8px', font: '12px sans-serif',
            boxShadow: '0 2px 8px rgba(0,0,0,.4)',
        });
        b.addEventListener('click', handler);
        return b;
    }

    function syncPanel() {
        const onEpisodePage = DETAIL_RE.test(location.hash);
        if (onEpisodePage && !panel) {
            panel = document.createElement('div');
            Object.assign(panel.style, {
                position: 'fixed', bottom: '20px', right: '20px', zIndex: 99999,
                display: 'flex', gap: '8px',
            });
            panel.appendChild(button('📍 Resume from this episode',
                'Continue Watching card will point at this exact episode (timeOffset=1)',
                () => apply('resume')));
            panel.appendChild(button('✓ Watched → next up',
                'Treat this episode as last watched; Continue Watching points at the following one',
                () => apply('watched')));
            document.body.appendChild(panel);
        } else if (!onEpisodePage && panel) {
            panel.remove();
            panel = null;
        }
    }

    window.addEventListener('hashchange', syncPanel);
    setInterval(syncPanel, 1000); // hash routing in stremio-web doesn't always fire hashchange
    syncPanel();
})();
