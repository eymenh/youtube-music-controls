# PUBLISHING A GITHUB RELEASE

This repository includes `.github/workflows/release.yml`. It automatically builds a Windows Vencord distribution with this plugin, then creates a **pre-release** after a version tag is pushed.

## One-time setup

1. Create a public GitHub repository named `youtube-music-controls` under your account (recommended: `eymenh`).
2. Push this repository's full contents to `main`.
3. Under **Settings → Actions → General**, enable GitHub Actions; allow workflows the necessary `contents: write` permission if your repository restricts it.
4. Review the repository and workflow code before publishing artifacts.

## First public beta

From the repository checkout:

```powershell
git checkout main
git pull --ff-only
git tag v3.2.3-beta.1
git push origin v3.2.3-beta.1
```

The tagged workflow clones the upstream Vencord source, records its commit, copies the custom plugin, compiles Vencord, packages the compiled `dist` and plugin source and publishes GitHub Release `v3.2.3-beta.1` with SHA-256 checksums.

**If compilation fails, no compiled binary or completed release will be published.** Inspect the GitHub Actions logs and fix the build rather than attaching unvalidated assets.

### Artifacts

| Asset | Meaning |
|---|---|
| `YouTube-Music-Controls-v3.2.3-beta.1-Windows-Vencord-dist.zip` | Compiled Vencord desktop assets including the plugin |
| `YouTube-Music-Controls-v3.2.3-beta.1-source.zip` | Plugin source + tests + documentation |
| `VENCORD_COMMIT.txt` | Exact upstream Vencord revision |
| `SHA256SUMS.txt` | SHA-256 checksum for release ZIPs |

To reproduce the compiled build, check out upstream `Vendicated/Vencord` at the recorded commit, copy the plugin sources, and run `pnpm install --frozen-lockfile && pnpm build --standalone` using the recorded build environment.

### Quick repository initialization

If GitHub CLI (`gh`) is installed and authenticated, you can create the repository from this folder:

```powershell
git init -b main
git add .
git commit -m "feat: initial YouTube Music Controls public beta"
gh repo create eymenh/youtube-music-controls --public --source . --remote origin --push
git tag v3.2.3-beta.1
git push origin v3.2.3-beta.1
```

An alternative is to create an empty repository at github.com and use `git remote add origin ...` then `git push -u origin main`.

**This repository package does not itself create a live GitHub Release** until it is pushed and the workflow runs successfully.
