# CHANGELOG

## [3.2.3-beta.1] — planned initial public beta

This beta packages the **v3.2.3 plugin source** for public distribution and adds Windows build/release automation.

### Included

- Discord-themed compact media controls and artwork.
- Embedded Electron window with an isolated persistent session.
- Background playback behavior and quick player re-opening.
- Persisted volume target and synchronous HTML media-volume guard.
- Regression tests with mocked Electron/DOM behavior.
- Windows build workflow and release integrity checks.

### Known limitations

- Google may reject login from an embedded Electron window.
- YouTube Music site updates may break DOM selectors.
- Sudden loud audio is not ruled out for all possible audio paths.
- Vencord integration and real account playback need independent testing.
- This repository does not ship a standalone executable.

### Release notes

See [.github/RELEASE_NOTES.md](.github/RELEASE_NOTES.md).
