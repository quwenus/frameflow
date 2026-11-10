# Frameflow

A local Windows app that turns a YouTube video into an MP3 audio file or an MP4 video. Frameflow opens in your browser, but the app and conversion tools run on your computer. No account or web hosting is needed.

## Get started on Windows

1. Open [Releases](https://github.com/quwenus/frameflow/releases) and download the **Frameflow-…-windows.zip** asset when a release is available.
2. Right-click the ZIP and choose **Extract All**. Keep all extracted files together in a writable folder such as Documents.
3. Double-click **Setup.cmd** once. It checks Node.js, yt-dlp, FFmpeg, and ffprobe and installs missing dependencies through Windows Package Manager. Installation needs internet access and may prompt for administrator permission.
4. Double-click **Start.cmd**. Your browser opens automatically when the app is ready. The local port is selected automatically.
5. Keep the launcher window open while you use the app. Press **Ctrl+C** in that window when finished.

Requirements: Windows 10/11, PowerShell 5.1+, Windows Package Manager (App Installer), and an internet connection. The ZIP contains the app and scripts, not bundled dependency executables. If no release asset is available yet, use **Code > Download ZIP**, extract it, and use the same Setup/Start steps.

## Convert a video

1. Copy the YouTube link for a video you own or have permission to download.
2. Paste it into **YouTube video URL** and click **Find video**.
3. Check the preview, choose **MP3** or **MP4**, and select a quality.
4. Check the permission box and click **Convert video**.
5. Click **Download file** when ready. Your browser handles saving the result.

Default limits are 30 minutes per video and 200 MiB per output. Downloads expire 30 minutes after conversion. MP3 offers 128, 192, and 320 kbps output settings; MP4 quality depends on available compatible streams. A higher MP3 bitrate does not improve the original audio quality. Size estimates can differ from the result.

Progress shows the current source download and can restart when fetching a separate audio stream. Merging and audio conversion use an indeterminate indicator. Playlists, batch conversion, trimming, accounts, live streams, and restricted videos are outside this version's scope.

## Troubleshooting

| What you see | What to do |
|---|---|
| Required tool is missing | Run Setup.cmd, then Start.cmd. The launcher detects installed tools even if your terminal has an old PATH. |
| winget is missing | Install/update Microsoft's App Installer, or use the manual dependency links below. |
| Browser does not open | Copy the localhost address printed in the launcher into your browser. Keep the launcher running. |
| App cannot start | Read `.launcher-error.log` in the extracted folder. Make sure another copy is not running from that same folder. |
| Video unavailable or conversion failed | Try a short public video you are allowed to download. YouTube can restrict automated requests; update yt-dlp with `winget upgrade --id yt-dlp.yt-dlp --exact`. |
| Download expired | Find and convert the video again. |
| Script blocked on a managed device | Ask your administrator about approved installation; do not disable your organization's security controls. |

To update Frameflow, stop it and extract the new release into a new folder. To remove it, stop it and delete its folder. Separately installed shared dependencies remain installed.

The service listens only on your computer when started with Start.cmd. Video requests go to YouTube; files are temporarily stored under `.data` and cleared after expiry or on restart. Only convert content you own or have permission to download.

## For developers

The dependency-free Node.js backend serves the interface, an in-memory job queue, and temporary downloads. yt-dlp fetches media and FFmpeg processes it. The sections below cover manual setup and configuration.

## Run locally

**Windows release ZIP:** extract all files, double-click `Setup.cmd` once, then `Start.cmd`. The launcher detects installed tools, picks a free local port, and opens the browser. Keep its window open while using the app; press Ctrl+C to stop. See [QUICK-START.txt](QUICK-START.txt).

Build a ZIP with `npm run package:windows`. See [RELEASE.md](RELEASE.md) for packaging and GitHub instructions. Dependencies are installed by Setup.cmd rather than bundled in the archive.

For development or manual setup:

1. Install Node.js 22.9+ (Node 24 recommended).
2. Install [yt-dlp](https://github.com/yt-dlp/yt-dlp#installation) and [FFmpeg](https://ffmpeg.org/download.html), including ffprobe. Use current versions. The official standalone yt-dlp release includes its JavaScript challenge components; Node is enabled as the JavaScript runtime.
3. Ensure `yt-dlp --version` and `ffmpeg -version` work in the terminal. Alternatively, copy `.env.example` to `.env` and set `YT_DLP_PATH` and `FFMPEG_PATH` to absolute executable paths. Keep ffprobe alongside ffmpeg.
4. Run `npm start`, then open http://127.0.0.1:3000.

Windows installation option (run yourself if not installed):

```powershell
winget install --id yt-dlp.yt-dlp --exact
winget install --id Gyan.FFmpeg --exact
# Restart your terminal to pick up PATH changes.
npm start
```

Use your own video or content you have permission to download. Private, restricted, DRM-protected, upcoming, and live content is unsupported. No browser cookies or access-control bypasses are used. YouTube may reject server requests or require authentication; the app reports a failure rather than pretending conversion succeeded.

## Configuration

All variables are optional; `.env` is read by `npm start`.

| Variable | Default | Meaning |
|---|---|---|
| HOST / PORT | 127.0.0.1 / 3000 | Bind address and port |
| YT_DLP_PATH | yt-dlp | Executable name or absolute path |
| FFMPEG_PATH | ffmpeg | Executable name or absolute path |
| MAX_DURATION_SECONDS | 1800 | Maximum video duration |
| MAX_FILE_BYTES | 209715200 | Maximum individual source stream and final output size |
| CONCURRENCY | 2 | Conversion workers; also bounds concurrent metadata lookups |
| MAX_QUEUE | 20 | Maximum queued plus active jobs |
| REQUESTS_PER_MINUTE | 30 | POST requests per socket IP per minute |
| JOB_TIMEOUT_MS | 600000 | Timeout per conversion, including download |
| FILE_TTL_MS | 1800000 | Retention after completion or failure |

Temporary files live in `.data/<random-job-id>`. Cleanup runs every 10 seconds, with downloads rejected immediately after expiry. UUID job folders are removed at startup because jobs do not survive a restart. Each active job has a temporary-storage watchdog at three times the output limit, sampled every second; this is an approximate guard, not a filesystem quota. Use an OS/container disk quota when exposing the service publicly.

MP3 options are encoding bitrates (128/192/320 kbps), not promises of source fidelity. MP4 options reflect available H.264 video with compatible audio. Output sizes are estimates where metadata permits them. Percentages describe the current source stream and may reset between audio and video; postprocessing is indeterminate.

## API

- `GET /api/health`: dependency availability and limits; 503 if unavailable.
- `POST /api/preview` with `{ "url": "https://youtu.be/VIDEO_ID" }`: normalized video metadata and a ten-minute preview token.
- `POST /api/jobs` with `{ "previewId": "...", "format": "mp3", "quality": 128, "permission": true }`: enqueue one conversion.
- `GET /api/jobs/:id`: queued, converting, ready, failed, or expired status.
- `GET /api/jobs/:id/download`: attachment; 409 before ready, 410 after expiry.

Job UUIDs act as unguessable download capabilities. Anyone with the URL can download while it remains valid. URLs are restricted to recognized YouTube hosts and normalized to a single canonical video URL. Commands use argument arrays with no shell, configuration files are ignored, output paths are generated by the server, and only fixed public assets are served.

## Verification

```sh
npm run check
npm test
```

Tests cover URL attacks, supported formats, duration/size filtering, missing executables, process timeouts, queue capacity, conversion failure, downloads, expiration, and cross-origin rejection. HTTP lifecycle tests use a clearly isolated fake media adapter; production always uses yt-dlp. To verify real media end to end, install the tools, start the app, paste an authorized public video, convert each format, and play the downloaded files. A passing automated suite alone does not establish live YouTube availability.

## Operating boundaries

This MVP runs as one process on one host, with in-memory jobs and rate limits. Do not run multiple processes against the same `.data` folder. Deploy behind HTTPS with an egress firewall blocking private networks, disk quotas, and appropriate reverse-proxy request limits. The application accepts only YouTube URLs, but yt-dlp follows upstream media URLs; network isolation is a separate infrastructure boundary. Forwarded client IP headers are intentionally not trusted. Queue persistence, accounts, playlists, trimming, and additional formats are outside scope.
