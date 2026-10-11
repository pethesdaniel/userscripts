// ==UserScript==
// @name         Letterboxd Tools
// @namespace    com.github.pethesdaniel.letterboxd
// @version      0.1
// @author       pethesdaniel & Claude
// @match        https://letterboxd.com/film/*
// @icon         https://www.letterboxd.com/favicon.ico
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // 'imdb'  -> use IMDb id (tt…). Best compatibility with Cinemeta + most stream addons.
  // 'tmdb'  -> use tmdb: prefix. Requires a TMDB metadata addon installed in Stremio.
  // 'auto'  -> prefer IMDb, fall back to tmdb: when no IMDb link is on the page.
  const PREFER = 'auto';

  // 'app'   -> stremio:///detail/... (opens the desktop/mobile app; note: the v5
  //            desktop shell has a bug where it may open but not navigate).
  // 'web'   -> https://web.stremio.com/#/detail/... (opens the web player; reliable).
  const TARGET = 'web';

  // Replace the "Where to watch" services list + "Go Pro" upsell with one big button.
  const REPLACE_WATCH_PANEL = true;

  const BTN_ID = 'stremio-open-button';
  const BIG_ID = 'stremio-watch-button';
  const TIME_ID = 'tools-modified-time'

  // Letterboxd tmdbType -> Stremio detail type
  function stremioType(tmdbType) {
    return tmdbType === 'tv' ? 'series' : 'movie';
  }

  function getImdbId() {
    const a = document.querySelector('a[href*="imdb.com/title/"]');
    if (!a) return null;
    const m = a.href.match(/tt\d+/);
    return m ? m[0] : null;
  }

  function getIds() {
    const type = stremioType(document.body.dataset.tmdbType);
    const tmdbId = document.body.dataset.tmdbId || null;
    const imdbId = getImdbId();

    let id = null;
    if (PREFER === 'imdb') id = imdbId;
    else if (PREFER === 'tmdb') id = tmdbId ? `tmdb:${tmdbId}` : null;
    else id = imdbId || (tmdbId ? `tmdb:${tmdbId}` : null); // auto

    return id ? { type, id } : null;
  }

  function buildLink() {
    const ids = getIds();
    if (!ids) return null;
    // Route: /detail/{type}/{metaId}/{videoId} (videoId == metaId for movies).
    // NOTE the empty host: stremio:///detail/... (three slashes). With two slashes
    // Stremio treats the first segment as a host and tries to install it as an addon.
    const route = `detail/${ids.type}/${ids.id}/${ids.id}`;
    return TARGET === 'web'
      ? `https://web.stremio.com/#/${route}`
      : `stremio:///${route}`;
  }

  function replaceWatchPanel() {
    if (!REPLACE_WATCH_PANEL) return;
    if (document.getElementById(BIG_ID)) return; // idempotent

    const watch = document.querySelector('.js-watch-panel #watch');
    if (!watch) return;

    const href = buildLink();
    if (!href) return;

    // Drop the streaming services list and the "Go Pro to customize" upsell.
    watch.querySelector('.services')?.remove();
    watch.querySelector('.other.-message')?.remove();

    const btn = document.createElement('a');
    btn.id = BIG_ID;
    btn.href = href;
    btn.textContent = '▶  Watch on Stremio';
    btn.title = `Open in Stremio (${getIds().id})`;
    Object.assign(btn.style, {
      display: 'block',
      textAlign: 'center',
      padding: '12px',
      marginBottom: '10px',
      borderRadius: '6px',
      fontWeight: '700',
      textDecoration: 'none',
      color: '#fff',
      background: 'linear-gradient(135deg, #7b5bf5, #8e5bd6)',
    });
    btn.addEventListener('mouseenter', () => (btn.style.filter = 'brightness(1.1)'));
    btn.addEventListener('mouseleave', () => (btn.style.filter = ''));

    // Keep the small "All services / JustWatch" row (if present) below the button.
    watch.insertBefore(btn, watch.firstChild);
  }

  function showTimeInHoursMinutes() {
    if (document.getElementById(TIME_ID)) return; // idempotent
    // Target the specific paragraph containing the runtime
    const targetElement = document.querySelector('p.text-link.text-footer');

    if (targetElement) {
        // Regex to match the number before 'mins' or '&nbsp;mins'
        const match = targetElement.innerHTML.match(/(\d+)\s*(?:&nbsp;)?mins/);

        if (match) {
            const totalMinutes = parseInt(match[1], 10);

            // Calculate hours and remaining minutes
            const hours = Math.floor(totalMinutes / 60);
            const minutes = totalMinutes % 60;

            // Format the output string (e.g., "2h 42m")
            const formattedTime = ` (${hours}h ${minutes}m)`;

            // Find the "mins" text node or position to insert the readable time
            // This safely injects the text right after the original minutes breakdown
            targetElement.innerHTML = targetElement.innerHTML.replace(
                /(\d+\s*(?:&nbsp;)?mins)/,
                `$1 <strong id="${TIME_ID}" style="color: #4caf50;">${formattedTime}</strong>`
            );
        }
    }
  }

  function run() {
    replaceWatchPanel();
    showTimeInHoursMinutes();
  }

  run();

  // Letterboxd re-renders parts of the page; keep our elements present.
  const obs = new MutationObserver(() => run());
  obs.observe(document.body, { childList: true, subtree: true });
})();
