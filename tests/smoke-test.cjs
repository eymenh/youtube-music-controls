// Self-contained syntax tests; no live YouTube Music session is needed.
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const assert = require('node:assert/strict');
const ts = require('typescript');
const root = path.join(__dirname, '..', 'src', 'userplugins', 'youtubeMusicControls');
const exportsObject = {};
for (const file of ['index.tsx', 'native.ts', 'bridge.ts']) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    const result = ts.transpileModule(source, {
        fileName: file,
        compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
        reportDiagnostics: true
    });
    const errors = result.diagnostics?.filter(d => d.category === ts.DiagnosticCategory.Error) || [];
    assert.equal(errors.length, 0, `${file}: ${errors.map(e => ts.flattenDiagnosticMessageText(e.messageText, ' ')).join(', ')}`);
    assert.ok(result.outputText.length > 100, 'no output for ' + file);
    console.log('OK TypeScript/TSX:', file);
    if (file === 'bridge.ts') new Function('exports','require',result.outputText)(exportsObject,()=>{});
}
const { SNAPSHOT_SCRIPT, INSTALL_VOLUME_GUARD_SCRIPT, CONTROL_SCRIPT, SEARCH_RESULTS_SCRIPT, PLAY_RESULT_SCRIPT } = exportsObject;
for (const [name, code] of Object.entries({ SNAPSHOT_SCRIPT, INSTALL_VOLUME_GUARD_SCRIPT, CONTROL_SCRIPT, SEARCH_RESULTS_SCRIPT, PLAY_RESULT_SCRIPT })) {
    vm.compileFunction('return (' + code + ')', []);
    console.log('OK renderer script:', name);
}
const listeners = new Map();
class FakeMediaElement {
    constructor() {
        this._volume = 1;
        this.muted = false;
        this.paused = true;
        this.duration = 220;
        this.currentTime = 11;
        this.poster = '';
        this.listeners = new Map();
    }
    get volume() { return this._volume; }
    set volume(value) { this._volume = value; }
    addEventListener(event, cb) { this.listeners.set(event, cb); }
    async play() { this.paused = false; }
    pause() { this.paused = true; }
}
const media = new FakeMediaElement();
const mediaElements = [media];
const albumURL = 'https://lh3.googleusercontent.com/testcover.jpg';
const img = { src: albumURL, currentSrc: albumURL };
const metadata = { title: 'Demo song', artist: 'Demo artist', artwork: [{ src: albumURL }] };
const doc = {
    documentElement: {},
    querySelector(sel) {
        if (sel === 'video' || sel === 'video, audio') return media;
        if (sel === 'ytmusic-player-bar #thumbnail img') return img;
        return null;
    },
    querySelectorAll(sel) { return sel === 'video, audio' ? mediaElements : []; }
};
const context = { document: doc, navigator: { mediaSession: { metadata } }, MutationObserver: class { observe(){} }, window: {}, HTMLMediaElement: FakeMediaElement, Number, HTMLElement: class {} };
const guard = vm.runInNewContext('(' + INSTALL_VOLUME_GUARD_SCRIPT + ')',context);
const first = guard(25);
assert.equal(first.installed, true);
assert.equal(first.locked, true, 'Synchronous volume lock required before Electron unmute');
assert.equal(first.hasMedia, true);
assert.equal(media.volume, 0.25);
media.volume = 1;
assert.equal(media.volume, 0.25, '100% volume must NEVER be applied, even momentarily');
const nextTrackMedia = new FakeMediaElement();
nextTrackMedia.volume = 1;
assert.equal(nextTrackMedia.volume, 0.25, 'New media element must be clamped before DOM attachment');
mediaElements.push(nextTrackMedia);
guard(37);
assert.equal(media.volume, 0.37);
assert.equal(nextTrackMedia.volume, 0.37);
nextTrackMedia.volume = 1;
assert.equal(nextTrackMedia.volume, 0.37, 'A later track cannot produce an audible 100% spike');
const snapshot = vm.runInNewContext(SNAPSHOT_SCRIPT, context);
assert.equal(snapshot.artwork, albumURL);
assert.equal(snapshot.title, 'Demo song');
assert.equal(snapshot.duration, 220);
assert.equal(snapshot.hasVideo, true);
assert.equal('volume' in snapshot, false, 'Never report external volume as the source of truth');
(async()=>{
    const control = vm.runInNewContext('(' + CONTROL_SCRIPT + ')', context);
    assert.equal((await control('playpause', 0)).ok,true);
    assert.equal(media.paused,false);
    assert.equal((await control('seek', 240)).ok,true);
    assert.equal(media.currentTime, 220);
    console.log('OK volume guard + artwork extraction + controls (mocked DOM)');
    const css = fs.readFileSync(path.join(root,'style.css'),'utf8');
    assert.match(css,/background:\s*transparent/);
    assert.match(css,/--font-primary/);
    console.log('OK Discord theme');
})().catch(err => { console.error(err); process.exitCode = 1; });
