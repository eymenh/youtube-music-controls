/* YouTube Music Controls — isolated native Electron audio engine.
 * SPDX-License-Identifier: GPL-3.0-or-later
 * No credential collection, cookie export, user-agent spoofing or DRM bypass.
 */
import { app, BrowserWindow, IpcMainInvokeEvent, net, session } from "electron";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CspPolicies, ImageSrc } from "@main/csp";
import { CONTROL_SCRIPT, INSTALL_VOLUME_GUARD_SCRIPT, PLAY_RESULT_SCRIPT, SEARCH_RESULTS_SCRIPT, SNAPSHOT_SCRIPT } from "./bridge";

for (const host of ["i.ytimg.com", "lh3.googleusercontent.com", "lh4.googleusercontent.com", "lh5.googleusercontent.com", "yt3.ggpht.com", "music.youtube.com"]) {
    CspPolicies[host] = [...new Set([...(CspPolicies[host] ?? []), ...ImageSrc])];
}

const ORIGIN = "https://music.youtube.com";
const PARTITION = "persist:vencord-youtube-music-controls";
const COMMANDS = new Set(["playpause", "previous", "next", "shuffle", "repeat", "seek", "volume"]);
const VOLUME_PATH = join(app.getPath("userData"), "vencord-youtube-music-volume.json");
// 25% is intentionally the safe default. NEVER read/reset it from the YouTube Music page.
function savedVolume(): number {
    try {
        const parsed = JSON.parse(readFileSync(VOLUME_PATH, "utf8"));
        if (Number.isInteger(parsed.volume) && parsed.volume >= 0 && parsed.volume <= 100) return parsed.volume;
    } catch { /* first run: use 25% */ }
    return 25;
}
let desiredVolume = savedVolume();
function setDesiredVolume(value: number) {
    desiredVolume = value;
    writeFileSync(VOLUME_PATH, JSON.stringify({ volume: value }), "utf8");
}

let player: BrowserWindow | null = null;
let allowDestroy = false;
let hideAfterFirstPlayback = false;
let loading = false;
let lastError = "";
let safeAudioPromise: Promise<void> | null = null;
let volumeGuardReady = false;
let volumeGuardEpoch = 0;

function isAllowedNavigation(rawUrl: string): boolean {
    try {
        const u = new URL(rawUrl);
        if (u.protocol !== "https:") return false;
        const host = u.hostname.toLowerCase();
        return host === "youtube.com" || host.endsWith(".youtube.com") ||
            host === "google.com" || host.endsWith(".google.com");
    } catch { return false; }
}
function musicPage(): boolean {
    if (!player || player.isDestroyed() || player.webContents.isDestroyed()) return false;
    try { return new URL(player.webContents.getURL()).origin === ORIGIN; }
    catch { return false; }
}

// Cache cover bytes inside the main process; Discord's CSP cannot block data:image/*. Limit memory.
const coverCache = new Map<string, { value: string; time: number }>();
const coverRequests = new Set<string>();
const MAX_COVER_BYTES = 2 * 1024 * 1024;
function allowedArtwork(rawUrl: string): boolean {
    try {
        const url = new URL(rawUrl);
        if (url.protocol !== "https:") return false;
        const h = url.hostname.toLowerCase();
        return h === "ytimg.com" || h.endsWith(".ytimg.com") ||
            h === "googleusercontent.com" || h.endsWith(".googleusercontent.com") ||
            h === "ggpht.com" || h.endsWith(".ggpht.com");
    } catch { return false; }
}
async function requestArtwork(url: string) {
    if (!allowedArtwork(url) || coverRequests.has(url)) return;
    coverRequests.add(url);
    try {
        const response = await net.fetch(url, { redirect: "error" });
        // Electron net.fetch can report an incorrect response.url; redirects are rejected instead.
        if (!response.ok) throw new Error("Bad artwork response");
        const type = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
        if (!type || !["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"].includes(type)) throw new Error("Unsupported image");
        const length = Number(response.headers.get("content-length"));
        if (length > MAX_COVER_BYTES) throw new Error("Image too large");
        const reader = response.body?.getReader();
        if (!reader) throw new Error("No image stream");
        const chunks: Uint8Array[] = [];
        let bytes = 0;
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            bytes += value.length;
            if (bytes > MAX_COVER_BYTES) { await reader.cancel(); throw new Error("Image too large"); }
            chunks.push(value);
        }
        if (!bytes) throw new Error("Empty image");
        const data = `data:${type};base64,${Buffer.concat(chunks.map(c => Buffer.from(c))).toString("base64")}`;
        coverCache.set(url, { value: data, time: Date.now() });
    } catch {
        // Retry a failed artwork in 60 seconds. Never leave a broken image icon visible.
        coverCache.set(url, { value: "", time: Date.now() });
    } finally {
        coverRequests.delete(url);
        while (coverCache.size > 8) coverCache.delete(coverCache.keys().next().value!);
    }
}
async function cachedArtwork(url: string): Promise<string> {
    if (!url || !allowedArtwork(url)) return "";
    const hit = coverCache.get(url);
    if (hit && (hit.value || Date.now() - hit.time < 60_000)) return hit.value;
    await requestArtwork(url);
    return coverCache.get(url)?.value ?? "";
}

async function enforceSafeVolume() {
    const win = player;
    if (!win || win.isDestroyed() || !musicPage()) return;
    if (safeAudioPromise) {
        // Serialize reinstallation and user-volume changes, never unmute for a stale document.
        await safeAudioPromise;
        if (player !== win || win.isDestroyed()) return;
    }
    const task = (async () => {
        try {
            // Desired volume can change while an IPC call is in flight.
            for (let attempt = 0; attempt < 3; attempt++) {
                const epoch = volumeGuardEpoch;
                const target = desiredVolume;
                const result = await win.webContents.executeJavaScript(`(${INSTALL_VOLUME_GUARD_SCRIPT})(${target})`, true);
                if (player !== win || win.isDestroyed() || epoch !== volumeGuardEpoch) return;
                if (!result?.installed || !result?.locked) {
                    volumeGuardReady = false;
                    lastError = "Protection du volume impossible : sortie audio maintenue muette par sécurité.";
                    win.webContents.setAudioMuted(true);
                    return;
                }
                volumeGuardReady = true;
                if (target === desiredVolume) {
                    // No media = stay muted until the next media-started-playing event.
                    if (result.hasMedia) win.webContents.setAudioMuted(false);
                    return;
                }
            }
        } catch {
            // Failure is fail-closed: never let a new document play at 100%.
            volumeGuardReady = false;
            win.webContents.setAudioMuted(true);
        }
    })();
    safeAudioPromise = task;
    try { await task; } finally { if (safeAudioPromise === task) safeAudioPromise = null; }
}

function createPlayer(): BrowserWindow {
    if (player && !player.isDestroyed()) return player;
    const win = new BrowserWindow({
        width: 1000, height: 760, minWidth: 580, minHeight: 420,
        show: false, autoHideMenuBar: true,
        backgroundColor: "#101013",
        webPreferences: {
            partition: PARTITION,
            nodeIntegration: false,
            nodeIntegrationInWorker: false,
            contextIsolation: true,
            sandbox: true,
            webSecurity: true,
            backgroundThrottling: false
        }
    });
    player = win;
    allowDestroy = false;
    hideAfterFirstPlayback = true;
    loading = true;
    lastError = "";
    volumeGuardReady = false;
    volumeGuardEpoch++;
    // The official page initially stays SILENT until the saved (or safe default) volume is applied.
    win.webContents.setAudioMuted(true);
    const updateOriginTitle = () => {
        try { win.setTitle(`YouTube Music — ${new URL(win.webContents.getURL()).hostname}`); }
        catch { win.setTitle("YouTube Music — site officiel"); }
    };
    win.setTitle("YouTube Music — site officiel");
    win.webContents.on("page-title-updated", event => { event.preventDefault(); updateOriginTitle(); });
    win.webContents.on("did-navigate", updateOriginTitle);
    win.webContents.setWindowOpenHandler(({ url }) => isAllowedNavigation(url)
        ? { action: "allow", overrideBrowserWindowOptions: {
            webPreferences: { partition: PARTITION, nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true }
        } }
        : { action: "deny" });
    win.webContents.on("will-navigate", (event, url) => {
        if (!isAllowedNavigation(url)) event.preventDefault();
    });
    win.webContents.on("did-start-navigation", (_event, info) => {
        if (info.isMainFrame && !info.isInPlace) {
            volumeGuardReady = false;
            volumeGuardEpoch++;
            win.webContents.setAudioMuted(true);
        }
    });
    win.webContents.on("did-start-loading", () => { loading = true; });
    win.webContents.on("did-stop-loading", () => { loading = false; });
    win.webContents.on("dom-ready", () => { void enforceSafeVolume(); });
    win.webContents.on("media-started-playing", () => {
        // Media events arrive AFTER audio starts. Never re-mute every track:
        // a synchronous prototype volume guard already prevents 100% resets.
        // Only mute when a new document has not yet installed the guard.
        if (!volumeGuardReady) win.webContents.setAudioMuted(true);
        // Hide the standalone UI immediately on first playback, but leave webContents alive.
        if (hideAfterFirstPlayback && !win.isDestroyed()) {
            win.hide();
            hideAfterFirstPlayback = false;
        }
        void enforceSafeVolume();
    });
    win.webContents.on("did-fail-load", (_event, code, description, _validatedURL, isMainFrame) => {
        if (isMainFrame && code !== -3) {
            loading = false;
            lastError = `Chargement impossible (${code}) : ${description}`;
        }
    });
    win.on("close", event => {
        if (!allowDestroy) {
            event.preventDefault();
            win.hide(); // Synchronous; the session and audio stay in memory.
        }
    });
    win.on("closed", () => { if (player === win) player = null; });

    const ses = session.fromPartition(PARTITION);
    ses.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    void win.loadURL(`${ORIGIN}/`).catch(err => {
        loading = false;
        lastError = `YouTube Music inaccessible : ${String(err)}`;
    });
    return win;
}

/** Starts YouTube Music without ever showing a separate Electron window. */
export function startPlayer(_event: IpcMainInvokeEvent): boolean {
    const win = createPlayer(); // BrowserWindow({ show: false }) is used on first launch.
    // Also cover the case where the engine was already started through the library button.
    if (win.isVisible()) win.hide();
    return true;
}

/** Explicit library / sign-in window. Only this action may call show(). */
export function openPlayer(_event: IpcMainInvokeEvent): boolean {
    const win = createPlayer();
    win.show();
    win.focus();
    return true;
}
export function hidePlayer(_event: IpcMainInvokeEvent): boolean {
    if (!player || player.isDestroyed()) return false;
    player.hide();
    hideAfterFirstPlayback = false;
    return true;
}
export function stopEngine(_event: IpcMainInvokeEvent): boolean {
    if (!player || player.isDestroyed()) return true;
    allowDestroy = true;
    player.destroy();
    player = null;
    loading = false;
    volumeGuardReady = false;
    volumeGuardEpoch++;
    return true;
}

export async function getState(_event: IpcMainInvokeEvent) {
    const active = !!player && !player.isDestroyed();
    const base = {
        active, loading, visible: active && player!.isVisible(),
        phase: active ? (musicPage() ? "music" : "login") : "off",
        error: lastError, title: "", artist: "", artwork: "",
        currentTime: 0, duration: 0, paused: true, hasVideo: false, volume: desiredVolume
    };
    if (!active || !musicPage() || loading) return base;
    try {
        await enforceSafeVolume();
        const snapshot = await player!.webContents.executeJavaScript(SNAPSHOT_SCRIPT, true);
        // Some YouTube Music versions omit Electron's media-started-playing event.
        // The regular state poll acts as a fallback for the first-play auto-hide.
        if (hideAfterFirstPlayback && snapshot?.hasVideo && snapshot.paused === false) {
            player!.hide();
            hideAfterFirstPlayback = false;
        }
        const url = typeof snapshot?.artwork === "string" ? snapshot.artwork : "";
        return {
            ...base, ...snapshot,
            // The page's video.volume must NEVER overwrite the stored user preference.
            volume: desiredVolume,
            artwork: allowedArtwork(url) ? url : ""
        };
    } catch {
        return { ...base, error: "Impossible de lire le lecteur (site modifié ou chargement en cours)." };
    }
}

/** Fetch artwork only when the displayed track changes; do not send base64 in every state poll. */
export async function getArtwork(_event: IpcMainInvokeEvent, url: string): Promise<string> {
    if (!musicPage() || typeof url !== "string" || url.length > 1800 || !allowedArtwork(url)) return "";
    return await cachedArtwork(url);
}

export async function command(_event: IpcMainInvokeEvent, name: string, argument?: number) {
    if (typeof name !== "string" || !COMMANDS.has(name)) throw new Error("Commande non autorisée");
    if (name === "volume") {
        if (typeof argument !== "number" || !Number.isInteger(argument) || argument < 0 || argument > 100)
            throw new Error("Volume invalide");
        setDesiredVolume(argument);
        if (musicPage()) await enforceSafeVolume();
        return { ok: true };
    }
    if (!musicPage()) return { ok: false, reason: "Ouvre d'abord YouTube Music." };
    if (name === "seek" && (typeof argument !== "number" || !Number.isFinite(argument) || argument < 0 || argument > 86400))
        throw new Error("Position invalide");
    const result = await player!.webContents.executeJavaScript(`(${CONTROL_SCRIPT})(${JSON.stringify(name)},${JSON.stringify(argument ?? 0)})`, true);
    return result?.ok ? { ok: true } : { ok: false, reason: result?.reason || "Bouton indisponible dans cette version de YouTube Music." };
}
export async function search(_event: IpcMainInvokeEvent, query: string) {
    if (typeof query !== "string" || !query.trim() || query.length > 160) throw new Error("Recherche invalide");
    await createPlayer().loadURL(`${ORIGIN}/search?q=${encodeURIComponent(query.trim())}`);
    return true;
}
export async function getResults(_event: IpcMainInvokeEvent) {
    if (!musicPage() || loading) return [] as { index: number; title: string; artist: string; }[];
    try { return await player!.webContents.executeJavaScript(SEARCH_RESULTS_SCRIPT, true) as { index: number; title: string; artist: string; }[]; }
    catch { return []; }
}
export async function playResult(_event: IpcMainInvokeEvent, index: number) {
    if (!Number.isInteger(index) || index < 0 || index > 29) throw new Error("Résultat invalide");
    if (!musicPage()) return false;
    return await player!.webContents.executeJavaScript(`(${PLAY_RESULT_SCRIPT})(${index})`, true) === true;
}
