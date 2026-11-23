/* YouTube Music Controls — JavaScript evaluated only on the official music.youtube.com page.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/** Extract metadata using legacy and 2026 Wiz-miniplayer layouts, then Media Session / playerApi. */
export const SNAPSHOT_SCRIPT = String.raw`(() => {
    const getText = selectors => {
        for (const selector of selectors) {
            const node = document.querySelector(selector);
            const value = node?.textContent?.trim();
            if (value) return value;
        }
        return '';
    };
    const media = document.querySelector('video') || document.querySelector('audio');
    const metadata = navigator.mediaSession?.metadata;
    const appLayout = document.querySelector('ytmusic-app-layout');
    let details;
    try { details = appLayout?.playerApi?.getPlayerResponse?.()?.videoDetails; } catch {}

    const valid = url => typeof url === 'string' && url.startsWith('https://');
    const thumbnails = [];
    const addImage = url => { if (valid(url)) thumbnails.push(url); };

    for (const selector of [
        'ytmusic-player-bar #thumbnail img',
        'ytmusic-player-bar img.ytmusic-player-bar',
        'ytmusic-player-bar #song-image img',
        'ytmusic-miniplayer img',
        'ytmusic-wiz-player-controls img',
        'ytmusic-player-page #song-image img',
        'ytmusic-player img',
        'ytmusic-player-bar img'
    ]) {
        const image = document.querySelector(selector);
        addImage(image?.currentSrc);
        addImage(image?.src);
        addImage(image?.getAttribute?.('src'));
    }
    for (const selector of [
        'ytmusic-player-bar #song-image',
        'ytmusic-player-bar #thumbnail',
        'ytmusic-player-page #song-image',
        'ytmusic-miniplayer #thumbnail'
    ]) {
        const element = document.querySelector(selector);
        const bg = element ? getComputedStyle(element).backgroundImage : '';
        if (bg && bg.includes('https://')) {
            const tail = bg.slice(bg.indexOf('https://'));
            const stops = [tail.indexOf('"'), tail.indexOf("'"), tail.indexOf(')')].filter(n => n >= 0);
            addImage(tail.slice(0, stops.length ? Math.min(...stops) : tail.length));
        }
    }
    for (const cover of metadata?.artwork || []) addImage(cover.src);
    for (const cover of details?.thumbnail?.thumbnails || []) addImage(cover.url);
    addImage(media?.poster);

    const title = getText([
        'ytmusic-player-bar .title', '.title.ytmusic-player-bar',
        'ytmusic-miniplayer .title', 'ytmusic-player-page .title'
    ]) || metadata?.title || details?.title || '';
    const artist = getText([
        'ytmusic-player-bar .byline', '.byline.ytmusic-player-bar',
        'ytmusic-miniplayer .byline', 'ytmusic-player-page .byline'
    ]) || metadata?.artist || details?.author || '';

    return {
        title: String(title).slice(0, 250),
        artist: String(artist).slice(0, 250),
        artwork: (thumbnails[0] || '').slice(0, 1800),
        currentTime: media && Number.isFinite(media.currentTime) ? media.currentTime : 0,
        duration: media && Number.isFinite(media.duration) ? media.duration : 0,
        paused: media ? media.paused : true,
        hasVideo: !!media
    };
})()`;

/**
 * Fail-closed volume protection. Electron keeps the entire page silent until
 * this guard has installed a synchronous HTMLMediaElement.volume interceptor.
 * Unlike volumechange, the setter runs BEFORE an excessive gain reaches media.
 * The interceptor applies to future audio/video elements in this SPA too.
 */
export const INSTALL_VOLUME_GUARD_SCRIPT = String.raw`(desired) => {
    const KEY = '__vencordYmcVolumeGuard';
    const clamp = value => Math.max(0, Math.min(100, Math.round(value)));
    const existing = window[KEY];
    if (existing?.locked && typeof existing.set === 'function') {
        existing.set(desired);
        return { installed: true, locked: true, hasMedia: !!document.querySelector('video, audio') };
    }

    const proto = HTMLMediaElement?.prototype;
    const descriptor = proto && Object.getOwnPropertyDescriptor(proto, 'volume');
    if (!descriptor?.configurable || typeof descriptor.get !== 'function' || typeof descriptor.set !== 'function') {
        // Do not release Electron mute if synchronously intercepting volume is impossible.
        return { installed: false, locked: false, hasMedia: !!document.querySelector('video, audio') };
    }

    const attached = new WeakSet();
    let target = clamp(desired);
    let correcting = false;
    const gain = () => target / 100;
    const getReal = media => descriptor.get.call(media);
    const setReal = (media, value) => descriptor.set.call(media, value);

    function enforce(media) {
        if (!media || correcting) return;
        correcting = true;
        try {
            if (Math.abs(getReal(media) - gain()) > 0.0001) setReal(media, gain());
        } finally { correcting = false; }
    }
    function attach() {
        document.querySelectorAll('video, audio').forEach(media => {
            if (!attached.has(media)) {
                attached.add(media);
                media.addEventListener('volumechange', () => enforce(media));
                media.addEventListener('loadedmetadata', () => enforce(media));
                media.addEventListener('play', () => enforce(media));
            }
            enforce(media);
        });
    }
    // Calls to media.volume = 1 are immediately clamped, BEFORE volumechange.
    // The original getter is retained, so the page sees the actual gain.
    try {
        Object.defineProperty(proto, 'volume', {
            configurable: true,
            enumerable: descriptor.enumerable,
            get() { return getReal(this); },
            set(_requested) { setReal(this, gain()); }
        });
    } catch {
        return { installed: false, locked: false, hasMedia: !!document.querySelector('video, audio') };
    }

    // Catch a newly created media element's first play even before DOM observation.
    // All versions of YouTube Music still retain control of pause/play state.
    const originalPlay = proto.play;
    if (typeof originalPlay === 'function') {
        try {
            Object.defineProperty(proto, 'play', {
                configurable: true, writable: true,
                value: function (...args) {
                    enforce(this);
                    return originalPlay.apply(this, args);
                }
            });
        } catch { /* The volume setter is sufficient; playback hook is optional. */ }
    }

    const observer = new MutationObserver(attach);
    observer.observe(document.documentElement || document, { childList: true, subtree: true });
    window[KEY] = {
        locked: true,
        set(value) { target = clamp(value); attach(); },
        get() { return target; }
    };
    attach();
    return { installed: true, locked: true, hasMedia: !!document.querySelector('video, audio') };
}`;

export const CONTROL_SCRIPT = String.raw`async (command, argument) => {
    const bar = document.querySelector('ytmusic-player-bar') || document.querySelector('ytmusic-wiz-player-controls') || document.querySelector('ytmusic-miniplayer');
    const media = document.querySelector('video') || document.querySelector('audio');
    const click = selectors => {
        for (const selector of selectors) {
            const element = bar?.querySelector(selector) || document.querySelector(selector);
            if (element instanceof HTMLElement) { element.click(); return true; }
        }
        return false;
    };
    switch (command) {
        case 'playpause': {
            if (!media) return { ok: false, reason: 'Aucun morceau chargé.' };
            if (media.paused) {
                try { await media.play(); return { ok: true }; }
                catch { return { ok: false, reason: 'Lecture bloquée : lance un morceau depuis le lecteur officiel.' }; }
            }
            media.pause(); return { ok: true };
        }
        case 'previous': return { ok: click(['.previous-button', '#previous', '[aria-label*="Previous"]', '[aria-label*="Précédent"]']) };
        case 'next': return { ok: click(['.next-button', '#next', '[aria-label*="Next"]', '[aria-label*="Suivant"]']) };
        case 'shuffle': return { ok: click(['.shuffle', '#shuffle', '[aria-label*="Shuffle"]', '[aria-label*="Aléatoire"]']) };
        case 'repeat': return { ok: click(['.repeat', '#repeat', '[aria-label*="Repeat"]', '[aria-label*="Répéter"]']) };
        case 'seek':
            if (!media || !Number.isFinite(media.duration) || media.duration <= 0) return { ok: false };
            media.currentTime = Math.max(0, Math.min(media.duration, argument));
            return { ok: true };
        default: return { ok: false };
    }
}`;

export const SEARCH_RESULTS_SCRIPT = String.raw`(() => {
    const rows = [...document.querySelectorAll('ytmusic-responsive-list-item-renderer')];
    return rows.slice(0, 30).map((row, index) => {
        const title = row.querySelector('.title, #title')?.textContent?.trim() || '';
        const artist = row.querySelector('.flex-columns, .secondary-flex-columns')?.textContent?.trim() || '';
        return { index, title: title.slice(0, 180), artist: artist.slice(0, 180) };
    }).filter(row => row.title).slice(0, 12);
})()`;

export const PLAY_RESULT_SCRIPT = String.raw`index => {
    const rows = [...document.querySelectorAll('ytmusic-responsive-list-item-renderer')];
    const row = rows[index];
    if (!row) return false;
    const target = row.querySelector('ytmusic-item-thumbnail-overlay-renderer, .title, #title');
    if (target instanceof HTMLElement) { target.click(); return true; }
    if (row instanceof HTMLElement) { row.click(); return true; }
    return false;
}`;
