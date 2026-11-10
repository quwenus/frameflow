# Release a Windows local app

The release ZIP is an application source bundle with a double-click launcher and dependency setup. It is not a standalone EXE or offline installer. Node.js, yt-dlp, and FFmpeg are installed separately by Setup.cmd; no third-party binaries are redistributed in the ZIP.

## Build and verify locally

```powershell
npm run check
npm test
npm run package:windows
```

Outputs: `dist/Frameflow-1.0.0-windows.zip` and its `.zip.sha256` checksum (version follows package.json). Private settings, Git metadata, temporary downloads, and dependency executables are excluded. Extract into a new folder, run Setup.cmd if needed, then Start.cmd. Test an authorized video in MP3 and MP4. To test dependency discovery and startup without opening a browser:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/launch.ps1 -SmokeTest
```

## Publish on GitHub

1. Create a GitHub repository and push the project source. Do not commit `dist`, `.env`, `.data`, or installed tools.
2. Update the version in package.json for each release, commit, and push.
3. Open **Releases > Draft a new release**. Create a matching tag, for example `v1.0.0`, select the intended commit, and publish.
4. The **Windows release package** workflow tests the source, builds the ZIP, and attaches the ZIP and checksum to the release. Check the Actions tab for its outcome.
5. Users download **Frameflow-…-windows.zip** from release assets, extract it, then run **Setup.cmd** and **Start.cmd**. GitHub's automatic source ZIP is not the named application asset.

Alternatively, manually attach the local ZIP and checksum in the release editor. Manual workflow runs from Actions generate a downloadable artifact without creating a release. Running the packager does not publish anything.

## Operating notes

- Windows 10/11, PowerShell 5.1+, and Windows Package Manager (App Installer).
- The launcher discovers winget tools even with an outdated terminal PATH.
- It forces loopback networking, chooses an unused port, and verifies its own instance before opening the browser.
- Do not also run `npm start` from the same folder. Concurrent launcher instances are blocked with a file lock.
- Keep the console open. Stop with Ctrl+C before deleting or replacing files.
- Jobs are temporary and do not survive restarts.
- Dependencies are not updated silently. Update through winget when needed.
- Script execution-policy changes apply only to the launched process, not the machine. Managed devices may still prohibit scripts.
