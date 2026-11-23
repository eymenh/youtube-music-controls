# CONTRIBUTING

Bug reports and pull requests are welcome. Please reproduce issues against the newest repository revision.

1. Open an issue with the Discord Desktop build, Vencord commit and operating system.
2. Provide reproduction steps and sanitized logs. **Never share cookies or Google session information.**
3. Run `npm install && npm test` before opening a pull request.
4. When modifying `native.ts`, retain Electron sandboxing, navigation allowlists and safe audio fallback.
5. For runtime changes, clearly distinguish mocked tests from playback verified on a live account.

Contributions are accepted under GPL-3.0-or-later.
