// Validate Electron IPC lifecycle, native volume persistence and cover fetching without contacting Google.
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const ts=require('typescript');
const {EventEmitter}=require('node:events');
const dir=path.join(__dirname,'..','src','userplugins','youtubeMusicControls');
const transpile=p=>ts.transpileModule(fs.readFileSync(path.join(dir,p),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const bridge={};
new Function('exports','require',transpile('bridge.ts'))(bridge,()=>{});
const nativeSource=transpile('native.ts');
const disk = new Map();
let currentWindow=null;
let permissionHandler=null;
let fetchCount=0;
const art = 'https://i.ytimg.com/vi/test123/hqdefault.jpg';
class MockWC extends EventEmitter {
    constructor() { super(); this.url=''; this.muted=false; this.guardVolume=null; this.destroyed=false; this.playing=false; this.muteHistory=[]; }
    isDestroyed(){return this.destroyed;}
    setAudioMuted(m){this.muted=m;this.muteHistory.push(m);}
    getURL(){return this.url;}
    setWindowOpenHandler(fn){this.popupHandler=fn;}
    executeJavaScript(code){
        if (code.includes('__vencordYmcVolumeGuard')) {
            this.guardVolume = Number(code.match(/\)\((\d+)\)$/)?.[1] ?? NaN);
            return Promise.resolve({installed:true,locked:true,hasMedia:true});
        }
        if (code.includes('ytmusic-player-bar #thumbnail img')) return Promise.resolve({title:'Demo song',artist:'Demo artist',artwork:art,currentTime:this.playing?9:0,duration:180,paused:!this.playing,hasVideo:true,volume:100});
        if (code.includes('document.querySelectorAll')) return Promise.resolve([]);
        return Promise.resolve({ok:true});
    }
}
class MockWindow extends EventEmitter {
    constructor(opts) { super();this.opts=opts;this.webContents=new MockWC();this.visible=opts.show;this.dead=false;currentWindow=this; }
    isDestroyed(){return this.dead;}
    isVisible(){return this.visible;}
    setTitle(t){this.title=t;}
    loadURL(url){this.webContents.url=url;this.webContents.emit('dom-ready');this.webContents.emit('did-stop-loading');return Promise.resolve();}
    show(){this.visible=true;}
    focus(){}
    hide(){this.visible=false;}
    destroy(){this.dead=true;this.webContents.destroyed=true;this.emit('closed');}
}
const mockElectron={
    app: {getPath(p){assert.equal(p,'userData');return '/mock-userdata';}},
    BrowserWindow: MockWindow,
    session: {fromPartition(partition){assert.equal(partition,'persist:vencord-youtube-music-controls');return {setPermissionRequestHandler(fn){permissionHandler=fn;}};}},
    net: {async fetch(url,opts){
        fetchCount++;
        assert.equal(url,art); assert.equal(opts.redirect,'error');
        const response = new Response(Buffer.from([137,80,78,71]), {status:200,headers:{'content-type':'image/png'}});
        return response;
    }}
};
const fsMock={
    readFileSync(p){ if(!disk.has(p)) throw new Error('missing');return disk.get(p);},
    writeFileSync(p,data){ disk.set(p,data); }
};
function createNative() {
    const out={};
    new Function('exports','require',nativeSource)(out, id=>{
        if(id==='electron')return mockElectron;
        if(id==='node:fs')return fsMock;
        if(id==='node:path')return path;
        if(id==='@main/csp')return {CspPolicies:{},ImageSrc:['img-src']};
        if(id==='./bridge')return bridge;
        throw Error(id);
    });
    return out;
}
(async()=>{
    const n=createNative();
    assert.equal((await n.getState()).active,false);
    assert.equal((await n.getState()).volume,25,'Safe first-run default is 25%, never 100%');
    // First launch must stay completely hidden, without waiting for playback.
    assert.equal(n.startPlayer({}),true);
    assert.equal(currentWindow.visible,false,'First start must never flash an Electron window');
    assert.equal((await n.getState({})).active,true,'Hidden engine remains alive');
    assert.equal(currentWindow.opts.webPreferences.sandbox,true);
    assert.equal(currentWindow.opts.webPreferences.nodeIntegration,false);
    assert.equal(currentWindow.webContents.url,'https://music.youtube.com/');
    assert.equal(typeof permissionHandler,'function');
    assert.equal(currentWindow.webContents.popupHandler({url:'https://accounts.google.com/'}).action,'allow');
    assert.equal(currentWindow.webContents.popupHandler({url:'javascript:alert(1)'}).action,'deny');
    assert.equal(currentWindow.webContents.popupHandler({url:'https://google.com.evil.test'}).action,'deny');
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(currentWindow.webContents.guardVolume,25);
    assert.equal(currentWindow.webContents.muted,false,'Unmute only after safe initial guard applied');
    assert.equal(n.openPlayer({}),true,'Sign-in/library window opens on explicit request');
    assert.equal(currentWindow.visible,true,'Explicit sign-in window must be visible');
    currentWindow.webContents.playing=true;
    currentWindow.webContents.emit('media-started-playing');
    assert.equal(currentWindow.visible,false,'Close UI instantly on first playback');
    assert.equal(currentWindow.webContents.muteHistory.slice(2).includes(true), false, 'Track start must not re-mute a safely guarded document');
    currentWindow.webContents.emit('media-started-playing');
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(currentWindow.webContents.muteHistory.slice(2).includes(true), false, 'Next track must not trigger new mute/unmute glitches');
    assert.equal(currentWindow.dead,false,'Hide must preserve the renderer and audio engine');
    assert.equal((await n.getState()).active,true);
    assert.equal((await n.getState()).volume,25,'Video 100% must not overwrite stored 25%');
    await n.command({},'volume',37);
    assert.equal(JSON.parse([...disk.values()][0]).volume,37);
    assert.equal(currentWindow.webContents.guardVolume,37);
    assert.equal((await n.getState()).volume,37);
    assert.equal(n.openPlayer({}),true);
    assert.equal(currentWindow.visible,true);
    let prevented=false;
    currentWindow.emit('close',{preventDefault(){prevented=true;}});
    assert.equal(prevented,true);
    assert.equal(currentWindow.visible,false);
    assert.equal(currentWindow.dead,false);
    const state=await n.getState({});
    assert.equal(state.title,'Demo song');
    assert.equal(state.artwork,art);
    const thumbnail=await n.getArtwork({},state.artwork);
    assert.match(thumbnail,/^data:image\/png;base64,/);
    assert.equal(await n.getArtwork({},state.artwork),thumbnail);
    assert.equal(fetchCount,1,'Artwork only fetched once per URL');
    await assert.rejects(n.command({},'volume',101),/invalide/);
    await assert.rejects(n.command({},'arbitraryjs','alert(1)'),/non autorisée/);
    n.stopEngine({});
    assert.equal((await n.getState()).active,false);
    // Second scenario: if Electron doesn't emit media-started-playing, the poll hides it.
    assert.equal(n.startPlayer({}),true);
    assert.equal(n.openPlayer({}),true);
    assert.equal(currentWindow.visible,true);
    currentWindow.webContents.playing=true;
    await n.getState({});
    assert.equal(currentWindow.visible,false,'Polling fallback hides on first active playback');
    n.stopEngine({});

    const restarted=createNative();
    assert.equal((await restarted.getState()).volume,37,'Last saved volume survives a process restart');
    console.log('OK Electron hide/autohide, volume persistence (25=>37), cover bytes, security and IPC mocks');
})().catch(e=>{console.error(e);process.exitCode=1;});
