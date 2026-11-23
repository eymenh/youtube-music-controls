## YouTube Music Controls — v3.2.3-beta.1

First public **beta** release of the experimental Discord/Vencord YouTube Music controller.

### Included

- Compact player: album cover, metadata, seek bar and transport controls.
- Isolated Electron YouTube Music session; no Chrome extension.
- Background playback with quick access to the music window.
- Persisted target volume and synchronous HTMLMediaElement volume guard.
- Plugin source, mock tests and build documentation.

### Assets

The Windows build workflow produces a compiled **Vencord distribution** with this plugin included, a matching plugin-source archive, a Vencord upstream revision identifier and SHA-256 checksums. The ZIP is **not** a standalone installer / executable. For source installation use `src/userplugins/youtubeMusicControls` and the official `pnpm build` / `pnpm inject` workflow.

### Limitations

Experimental. Google login may be rejected in an embedded browser. Dynamic YouTube Music DOM integration and audio protection are not guaranteed across versions. **Use a low Windows volume during initial testing.**

See the repository README, SECURITY.md and CHANGELOG.md.
