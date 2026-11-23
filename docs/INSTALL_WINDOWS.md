# WINDOWS INSTALLATION

**Supported target:** Discord Desktop with a custom Vencord source build.

## Prerequisites

Install Git, Node.js, pnpm and Discord Desktop. A custom plugin is **not** installed by dropping a ZIP into `%APPDATA%\Vencord\dist`.

## Use an existing Vencord checkout

For example, `C:\Users\<username>\Vencord`:

```powershell
cd "$HOME\Vencord"
pnpm.cmd install --frozen-lockfile
```

Extract the source archive or clone this repository. In its root folder:

```powershell
.\scripts\install-local.ps1 -VencordPath "$HOME\Vencord"
```

Then:

```powershell
cd "$HOME\Vencord"
pnpm.cmd build
pnpm.cmd inject
```

Fully exit Discord from the notification area and restart. Enable the plugin in Vencord settings.

## Authentication and playback

Click **Start in background**. Use the small external-window icon next to the track to open YouTube Music for account sign-in or browsing. The window can be hidden while Electron continues to run its media renderer. Google may reject login in embedded browsers; this project does not bypass Google security restrictions.

## Volume safety

The default target volume is 25% if no local preference exists. The actual output can differ depending on Windows mixer levels and media pipelines. Keep Windows output **low during first use**.

## Troubleshooting

- `Pont Electron indisponible`: recompile from the same Vencord checkout and re-inject the desktop build.
- `Google login blocked`: an Electron account sign-in restriction; no guaranteed workaround exists.
- `Artwork missing`: the media page may not expose a supported thumbnail, or the remote image may be unavailable.
- `No sound`: ensure playback has been started once by a user gesture and the media guard initialized.
- `Sudden volume spike`: reduce system volume immediately; report your Discord/Vencord versions and reproduction steps.

## Compiled release artifact

The GitHub Release *Windows-Vencord-dist.zip* is the **compiled desktop Vencord distribution**, not a drag-and-drop Vencord plugin DLL or a standard Windows setup. The reliable installation procedure is the source-build process above, using the release source ZIP. The binary distribution can be used by advanced users with their own compatible injection tools.
