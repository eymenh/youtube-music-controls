/* YouTube Music Controls — experimental native Electron player for Vencord desktop.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import "./style.css";

import ErrorBoundary from "@components/ErrorBoundary";
import definePlugin, { PluginNative } from "@utils/types";
import { React } from "@webpack/common";

type PlayerState = {
    active: boolean;
    visible: boolean;
    loading: boolean;
    phase: string;
    error: string;
    title: string;
    artist: string;
    artwork: string;
    currentTime: number;
    duration: number;
    paused: boolean;
    hasVideo: boolean;
    volume: number;
};
type ControlName = "playpause" | "previous" | "next" | "repeat" | "shuffle" | "seek" | "volume";

const EMPTY: PlayerState = {
    active: false, visible: false, loading: false, phase: "off", error: "",
    title: "", artist: "", artwork: "", currentTime: 0, duration: 0,
    paused: true, hasVideo: false, volume: 100
};
// Vencord builds the native bridge from the plugin folder's PascalCase name.
const Native = (VencordNative.pluginHelpers["YouTube Music Controls"]
    ?? VencordNative.pluginHelpers.YoutubeMusicControls
    ?? VencordNative.pluginHelpers.YouTubeMusicControls
    ?? VencordNative.pluginHelpers.youtubeMusicControls) as PluginNative<typeof import("./native")> | undefined;

const paths = {
    play: "M8 5v14l11-7z",
    pause: "M7 5h4v14H7zM15 5h4v14h-4z",
    previous: "M5 5h2v14H5zM19 5v14L8 12z",
    next: "M17 5h2v14h-2zM5 5v14l11-7z",
    repeat: "M17 2l4 4-4 4V7H6v4H4V6a1 1 0 0 1 1-1h13zM7 22l-4-4 4-4v3h11v-4h2v5a1 1 0 0 1-1 1H6z",
    shuffle: "M4 4h3l13 16M17 16h3v4h-4M4 20h3l4-5M15 9l5-5M17 4h3v4",
    volume: "M11 5L6 9H3v6h3l5 4V5zM15 9a5 5 0 0 1 0 6M18 6a9 9 0 0 1 0 12",
    external: "M14 4h6v6M20 4l-9 9M18 14v5H5V6h5",
    power: "M12 2v10M5 5a10 10 0 1 0 14 0",
    music: "M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zm12-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0z"
};
function Icon({ name, size = 17 }: { name: keyof typeof paths; size?: number; }) {
    return <svg aria-hidden="true" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d={paths[name]} />
    </svg>;
}
// Official favicon served by music.youtube.com. The inline icon is a network/CSP fallback.
function YouTubeMusicFavicon() {
    const [failed, setFailed] = React.useState(false);
    if (failed) return <svg className="vc-ymc-site-icon" aria-hidden="true" viewBox="0 0 32 32">
        <circle cx="16" cy="16" r="16" fill="#ff0033" />
        <circle cx="16" cy="16" r="9.5" fill="none" stroke="white" strokeWidth="2" />
        <path d="M13.6 10.9L22 16l-8.4 5.1z" fill="white" />
    </svg>;
    return <img className="vc-ymc-site-icon" src="https://music.youtube.com/img/favicon_32.png"
        alt="" aria-hidden="true" onError={() => setFailed(true)} />;
}
function fmt(value: number): string {
    const sec = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}
function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}
function PlayerPanel() {
    const [state, setState] = React.useState<PlayerState>(EMPTY);
    const [notice, setNotice] = React.useState("");
    const [busy, setBusy] = React.useState(false);
    const [uiVolume, setUiVolume] = React.useState(25);
    const [coverErrored, setCoverErrored] = React.useState(false);
    const [coverData, setCoverData] = React.useState("");
    const volumeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const volumeLockUntil = React.useRef(0);

    const refresh = React.useCallback(async () => {
        if (!Native) return;
        try {
            const current = await Native.getState() as PlayerState;
            setState(current);
            if (current.hasVideo && Date.now() > volumeLockUntil.current && Number.isFinite(current.volume)) {
                // Main process owns the volume; never trust YouTube Music video.volume.
                setUiVolume(clamp(Math.round(current.volume), 0, 100));
            }
        } catch (e) {
            setNotice(`Communication avec Electron impossible : ${String(e)}`);
        }
    }, []);

    React.useEffect(() => {
        void refresh();
        const timer = setInterval(() => void refresh(), 1600);
        return () => {
            clearInterval(timer);
            if (volumeTimer.current) clearTimeout(volumeTimer.current);
        };
    }, [refresh]);

    React.useEffect(() => {
        let cancelled = false;
        setCoverData("");
        setCoverErrored(false);
        if (Native && state.artwork) {
            void Native.getArtwork(state.artwork).then(src => {
                if (!cancelled) setCoverData(src);
            }).catch(() => {
                if (!cancelled) setCoverData("");
            });
        }
        return () => { cancelled = true; };
    }, [state.artwork]);

    async function invoke(action: () => Promise<unknown>) {
        if (!Native) {
            setNotice("Pont natif indisponible : reconstruis Vencord, puis redémarre complètement Discord.");
            return;
        }
        setBusy(true);
        try {
            await action();
            await refresh();
            setNotice("");
        } catch (e) {
            setNotice(String(e));
        } finally {
            setBusy(false);
        }
    }
    async function control(name: ControlName, value?: number) {
        if (!Native) return;
        try {
            const result = await Native.command(name, value) as { ok: boolean; reason?: string };
            if (!result.ok) setNotice(result.reason || "Commande indisponible.");
            else setNotice("");
            await refresh();
        } catch (e) {
            setNotice(`Commande impossible : ${String(e)}`);
        }
    }
    function queueVolume(value: number) {
        const next = clamp(Math.round(value), 0, 100);
        setUiVolume(next);
        volumeLockUntil.current = Date.now() + 1100;
        if (volumeTimer.current) clearTimeout(volumeTimer.current);
        volumeTimer.current = setTimeout(() => void control("volume", next), 75);
    }

    const inactive = !state.active || state.phase !== "music" || state.loading;
    const artwork = !coverErrored ? coverData : "";

    return <section className="vc-ymc" aria-label="YouTube Music Controls">
        <header className="vc-ymc-header">
            <YouTubeMusicFavicon /> <strong>YOUTUBE MUSIC</strong>
            <span className="vc-ymc-header-state">{state.active ? (state.loading ? "CHARGEMENT" : "ACTIF") : "INACTIF"}</span>
        </header>

        {!Native && <p className="vc-ymc-alert">Pont Electron indisponible. Le plugin nécessite une compilation Vencord Desktop avec native.ts.</p>}

        {!state.active ? <div className="vc-ymc-empty">
            <strong>Lecteur intégré à Discord</strong>
            <p>Le moteur démarre sans fenêtre. Après démarrage, utilise le bouton d’ouverture ↗ à droite du morceau pour te connecter ou choisir un titre.</p>
            <button className="vc-ymc-primary" disabled={!Native || busy} onClick={() => void invoke(() => Native!.startPlayer())}>Démarrer en arrière-plan</button>
        </div> : <>
            {state.phase !== "music" && <p className="vc-ymc-info">Connexion Google ou redirection en cours dans la fenêtre intégrée.</p>}

            <div className="vc-ymc-track">
                {artwork ? (
                    <img
                        className="vc-ymc-cover"
                        src={artwork}
                        alt="Pochette de l'album"
                        referrerPolicy="no-referrer"
                        onError={() => setCoverErrored(true)}
                    />
                ) : (
                    <div className="vc-ymc-cover vc-ymc-cover-fallback"><Icon name="music" size={18} /></div>
                )}

                <div className="vc-ymc-meta">
                    <strong title={state.title}>{state.title || (state.loading ? "Chargement…" : "Aucun morceau")}</strong>
                    <span title={state.artist}>{state.artist || "YouTube Music"}</span>
                </div>

                <button className="vc-ymc-icon vc-ymc-open" title="Ouvrir YouTube Music" aria-label="Ouvrir YouTube Music" onClick={() => void invoke(() => Native!.openPlayer())}><Icon name="external" size={15} /></button>
            </div>

            <div className="vc-ymc-timeline">
                <span>{fmt(state.currentTime)}</span>
                <input
                    aria-label="Progression du morceau"
                    disabled={inactive || !state.duration}
                    type="range"
                    min={0}
                    max={Math.max(1, state.duration)}
                    value={Math.min(state.currentTime, Math.max(1, state.duration))}
                    step={1}
                    onChange={event => void control("seek", Number(event.currentTarget.value))}
                />
                <span>{fmt(state.duration)}</span>
            </div>

            <div className="vc-ymc-controls">
                <button className="vc-ymc-icon" disabled={inactive} title="Lecture aléatoire" aria-label="Lecture aléatoire" onClick={() => void control("shuffle")}><Icon name="shuffle" size={16} /></button>
                <button className="vc-ymc-icon" disabled={inactive} title="Précédent" aria-label="Précédent" onClick={() => void control("previous")}><Icon name="previous" size={16} /></button>
                <button className="vc-ymc-icon vc-ymc-play" disabled={inactive} title={state.paused ? "Lecture" : "Pause"} aria-label={state.paused ? "Lecture" : "Pause"} onClick={() => void control("playpause")}><Icon name={state.paused ? "play" : "pause"} size={18} /></button>
                <button className="vc-ymc-icon" disabled={inactive} title="Suivant" aria-label="Suivant" onClick={() => void control("next")}><Icon name="next" size={16} /></button>
                <button className="vc-ymc-icon" disabled={inactive} title="Répétition" aria-label="Répétition" onClick={() => void control("repeat")}><Icon name="repeat" size={16} /></button>
            </div>

            <div className="vc-ymc-volume">
                <Icon name="volume" size={15} />
                <input
                    aria-label="Volume"
                    disabled={inactive || !state.hasVideo}
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={uiVolume}
                    onChange={event => queueVolume(Number(event.currentTarget.value))}
                />
                <span>{uiVolume}%</span>
            </div>

            <div className="vc-ymc-actions">
                <button type="button" className="vc-ymc-power" title="Arrêter le moteur audio" aria-label="Arrêter YouTube Music" onClick={() => void invoke(() => Native!.stopEngine())}>
                    <Icon name="power" size={14} />
                </button>
            </div>
        </>}

        {(notice || state.error) && <p className="vc-ymc-alert" role="status">{notice || state.error}</p>}
    </section>;
}

export default definePlugin({
    name: "YouTube Music Controls",
    description: "Lecteur YouTube Music expérimental dans Electron/Discord : compte personnel, session persistante et contrôles intégrés, sans extension.",
    authors: [{ name: "Community", id: 0n }],
    tags: ["Media", "Activity"],
    patches: [{
        find: "#{intl::USER_PROFILE_ACCOUNT_POPOUT_BUTTON_A11Y_LABEL}",
        replacement: {
            match: /(?<=\i\.jsxs?\)\()(\i),{(?=[^}]*?userTag:\i,occluded:)/,
            replace: "$self.PanelWrapper,{VencordOriginal:$1,"
        }
    }],
    PanelWrapper({ VencordOriginal, ...props }) {
        return <>
            <ErrorBoundary fallback={() => <p>Impossible de charger YouTube Music Controls. Consulte la console Discord.</p>}>
                <PlayerPanel />
            </ErrorBoundary>
            <VencordOriginal {...props} />
        </>;
    }
});
