<div align="center">

<img src="src-tauri/icons/128x128.png" width="88" alt="DynIs icon" />

# DynIs

**A Dynamic Island for your desktop.** Music, live activities and quick controls, right at the top of your screen.

[![License: GPL v3](https://img.shields.io/badge/license-GPLv3-blue.svg)](LICENSE)
![Windows](https://img.shields.io/badge/Windows-10%20%7C%2011-0078D6?logo=windows&logoColor=white)
![Linux](https://img.shields.io/badge/Linux-beta-FCC624?logo=linux&logoColor=black)
![macOS](https://img.shields.io/badge/macOS-planned-lightgrey?logo=apple&logoColor=white)
[![Latest release](https://img.shields.io/github/v/release/ShadowKnight711/DynIs?label=release)](https://github.com/ShadowKnight711/DynIs/releases/latest)

[Download](https://github.com/ShadowKnight711/DynIs/releases/latest) · [Features](#features) · [Install](#install) · [Build from source](#build-from-source) · [FAQ](#faq)

</div>

---

## Screenshots

<!-- Add screenshots or a short GIF here, e.g. docs/media/island.gif -->

> Screenshots are coming soon. If you'd like to help, open an issue with a capture of the island on your desktop.

---

## Features

### Island & Live Activities

- A capsule (or a classic notch) that lives at the top of the screen and grows when something happens.
- **Live activities:** charging, headphones and their battery, downloads with exact progress, timers, clipboard to shelf, notifications from other apps, and your own scripts.
- **Smart by default:** it floats over your windows and steps aside for maximized and full-screen apps, so it never takes space from them. On Windows, an optional "Reserve Space" mode keeps windows below it.
- Ink, Glass and Glass (live blur) materials. Dark by design.

### Music & Spotify

- Now playing for any app that reports to the system (Spotify, browsers, Apple Music on Windows, VLC…), with album art, a visualizer and controls.
- **Spotify:** connect your own Spotify app to get Up Next with artwork, like and unlike, shuffle and repeat, seeking, devices (Spotify Connect), search to play or add to the queue, and your playlists. [Set up Spotify →](docs/SETUP-SPOTIFY.md)

### Web media (browser extension)

- The **DynIs Downloads & Media** extension shows what's playing on YouTube, YouTube Music, Spotify Web, Apple Music and SoundCloud, labelled like "YouTube · Brave", with the up next list.
- Play/pause, next, previous, seek and the up next rows control the tab. Each site can be turned off, and only media information is read. [Install the extension →](docs/EXTENSION.md)

### Widgets & Home

- Weather, calendar month, clocks and world clock, timers (Pomodoro, stopwatch, countdown), to-dos, quick notes, system stats, drives, uptime, battery, photos and more. Add, remove, reorder and resize them.

### Control Center

- Volume, brightness, Wi-Fi, Bluetooth, Focus, Keep Awake, Snap Window and app or folder shortcuts, as tiles you can rearrange.

### Downloads

- Browser downloads (Brave, Chrome, Edge, Firefox) with exact progress through the extension, and **Internet Download Manager** downloads on Windows.

### Calendar

- Google Calendar (read-only): dots on days with events, your next events, and a heads-up 10 minutes before. [Set up Google Calendar →](docs/SETUP-GOOGLE.md)

---

## Install

### Windows 10 / 11

1. Download `DynIs_<version>_x64-setup.exe` from [Releases](https://github.com/ShadowKnight711/DynIs/releases/latest).
2. Run it. Windows SmartScreen may warn about an unsigned app: choose **More info → Run anyway**.
3. Setup opens on first launch.

### Linux (beta)

Built for Zorin OS 18 and other GNOME desktops based on Ubuntu 24.04 or newer.

- **.deb:** `sudo apt install ./DynIs_<version>_amd64.deb`
- **AppImage:** `chmod +x DynIs_<version>_amd64.AppImage && ./DynIs_<version>_amd64.AppImage`

See [Linux notes](docs/LINUX-BUILD.md) for what works on Linux, and why the Xorg session is recommended.

### macOS

Planned. The work in progress is described in [docs/MAC-BUILD.md](docs/MAC-BUILD.md).

### First-run setup

DynIs walks you through it the first time it starts: the browser extension, Google Calendar, Spotify, Live Activities, and choosing Capsule or Classic with a material. Every step is optional, and you can open it again from **Settings → About**.

---

## Build from source

Requirements: [Bun](https://bun.sh) 1.4+, Rust stable, and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your platform.

```bash
bun install
bun run tauri dev      # run in development
bun run tauri build    # build an installer
bun test               # frontend unit tests
cd src-tauri && cargo test --locked   # Rust unit tests
```

Linux builds and their system packages are covered in [docs/LINUX-BUILD.md](docs/LINUX-BUILD.md). The browser extension's Firefox copy is generated with `bun scripts/build-extension.mjs`.

---

## Roadmap

- [x] Spotify (2.1)
- [x] Web media from the browser extension (2.1)
- [x] Linux, Zorin OS first (2.1, beta)
- [ ] macOS (planned)
- [ ] Signed releases

---

## FAQ

**Why is DynIs missing from my screenshots and screen recordings?**
That's the Glass (live blur) material: to blur what's behind the island, DynIs has to be hidden from screen capture. Choose Ink or Glass to show it again.

**Why can't DynIs skip songs on Spotify?**
Controlling playback through the Spotify Web API needs Spotify Premium (Spotify's rule). Up Next, likes and playlists work on Free.

**Why do I have to create my own Spotify and Google apps?**
DynIs has no server and no shared keys. Your own Client ID keeps your sign-in between you and Spotify or Google.

**Why isn't the extension in the Chrome Web Store?**
It's installed with Developer mode for now (a few clicks, guided in setup). See [docs/EXTENSION.md](docs/EXTENSION.md).

**Does DynIs send my data anywhere?**
No. Everything stays on your PC. The only network requests are the ones you turn on: weather, Google Calendar and Spotify.

**Where are my settings?**
`%APPDATA%\com.kevin.dynis\settings.json` on Windows, `~/.config/com.kevin.dynis/settings.json` on Linux. Every key is documented in [SETTINGS.md](SETTINGS.md).

---

## Credits

**Made by Kevin** · Based on [Bloom](https://github.com/SehajveerSingh2005/bloom) by Sehajveer Singh.

## License

[GNU General Public License v3.0](LICENSE). DynIs is a modified version of Bloom; both are GPLv3.
