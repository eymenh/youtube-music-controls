# SECURITY

## Reporting

Please use GitHub **private vulnerability reporting** where available, rather than posting credentials, cookies or personal session data in a public issue. Never attach a session directory or a HAR containing authentication headers.

## Model and boundaries

- Electron session: `persist:vencord-youtube-music-controls` (separate from Discord).
- The embedded page is sandboxed, with Node integration disabled.
- Application data contains a persisted volume preference and the dedicated Electron browsing session.
- Artwork is fetched from an allowlist of public media hostnames and bounded in size.
- No YouTube or Google credentials are deliberately collected by plugin code.

## Audio safety

The synchronous guard intercepts standard HTML media volume setters; Web Audio, platform-level output controls and site changes may bypass it. **Do not treat volume guarding as hearing protection.** Start at a low Windows mixer/system volume and verify behavior after each update.

## Compatibility

This is a custom Discord client modification and may break with Discord, Vencord, Electron or Google changes. Using unofficial client modifications may carry account or product-policy risks. The project does not circumvent account checks, DRM or authentication restrictions.
