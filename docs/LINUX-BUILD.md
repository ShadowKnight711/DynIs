# DynIs for Linux (beta)

DynIs 2.2 runs on Zorin OS 17 and other Ubuntu 22.04 / 24.04-based GNOME desktops. It's the same app as on Windows, with a Linux backend (`src-tauri/src/linux`).

## Install

**.deb (recommended on Zorin/Ubuntu):**

```bash
sudo apt install ./DynIs_2.2.0_amd64.deb
```

**AppImage:** AppImages need FUSE 2, which Ubuntu 22.04+ doesn't install by default.

```bash
sudo apt install libfuse2        # Zorin 17 / Ubuntu 22.04 (on 24.04: libfuse2t64)
chmod +x DynIs_2.2.0_amd64.AppImage
./DynIs_2.2.0_amd64.AppImage
```

DynIs starts with setup the first time. "Launch at Login" in Settings adds `~/.config/autostart/DynIs.desktop`.

## Xorg or Wayland

Use the **Zorin Desktop (Xorg)** session for the best experience (choose it with the gear on the login screen). GNOME's Wayland compositor doesn't let apps keep a bar above other windows at the screen edge, make part of a window click-through, or see other apps' windows, so DynIs always runs through X11 (XWayland on a Wayland session). On Wayland:

- the island shows and works, but hovering may need a click over native Wayland windows;
- Smart mode can't see maximized or full-screen Wayland apps, so the island doesn't step aside for them (use Peek, or the Xorg session);
- Snap Window only moves X11 apps.

`DYNIS_ALLOW_WAYLAND=1` skips forcing X11 (for testing only).

## What works on Linux

| Feature | Linux | How |
| --- | --- | --- |
| Island, Smart/Overlay/Peek | ✅ | X11 window; EWMH events for maximized/full-screen (Xorg) |
| Reserve Space (Fixed) | — | Not offered: Linux never reserves screen space |
| Now playing + controls | ✅ | MPRIS (Spotify, Firefox, Chromium, Brave, Chrome, Edge, VLC, Rhythmbox, mpv…) |
| Spotify (Up Next, likes, devices…) | ✅ | Spotify Web API, token in GNOME Keyring |
| Web media + downloads (extension) | ✅ | Native messaging host in `~/.config/<browser>` and `~/.mozilla` |
| Battery | ✅ | UPower |
| Headphones battery | ✅ | BlueZ (devices that report their battery) |
| Volume | ✅ | PipeWire (`wpctl`), else PulseAudio (`pactl`) |
| Brightness | ✅ laptops | Backlight through logind (no root). Desktop monitors: no |
| Keep Awake | ✅ | GNOME session inhibitor, else `systemd-inhibit` |
| Snap Window | ✅ Xorg | EWMH |
| Lock | ✅ | `loginctl lock-session` |
| Clipboard to Shelf / Recent copies | ✅ | Text, while turned on |
| Notifications from other apps | ✅ opt-in | Reads Notify calls on the session bus (off by default) |
| Google Calendar, widgets, stats | ✅ | Same as Windows |
| Internet Download Manager | — | Windows only |
| Glass (live blur) | — | Windows only (Ink and Glass work) |
| DynIs dock | — | Zorin's own taskbar stays |
| Wi-Fi / Bluetooth panels, per-app volume | — | Opens GNOME Settings instead |

## The browser extension on Linux

DynIs registers its native messaging host for Brave, Chrome, Chromium, Edge, Vivaldi and Firefox when it starts (the browser must have been run once). Install the extension from **Settings → Browser**, like on Windows.

**Snap and Flatpak browsers can't use it:** they're sandboxed and can't start an outside program. Zorin installs Firefox as a .deb, which works. If your browser is a Snap or Flatpak (`snap list`, `flatpak list`), install the .deb from the browser's website instead (Brave, Chrome and Edge publish .deb packages).

With the AppImage, the host points at the `.AppImage` file: keep it in one place (e.g. `~/Applications`). If you move it, start DynIs once so it re-registers.

## Top bar icon

DynIs puts an icon in the top bar (Settings, Quit). On Zorin and Ubuntu it shows through the AppIndicator extension, which is on by default.

## Files

- Settings: `~/.config/com.kevin.dynis/settings.json`
- Activities and browser bridge: `~/.local/share/com.kevin.dynis/`
- Sign-in tokens: the GNOME Keyring (service "DynIs")

## Troubleshooting

- **Blank or black island:** DynIs turns off WebKitGTK's DMA-BUF renderer by default (`WEBKIT_DISABLE_DMABUF_RENDERER=1`), which fixes this on most GPUs. If it persists, start it with `LIBGL_ALWAYS_SOFTWARE=1 bloom` (the .deb installs the program as `/usr/bin/bloom`).
- **No volume changes shown:** install `pulseaudio-utils` (provides `pactl`, which also works with PipeWire).
- **No top bar icon:** enable "AppIndicator and KStatusNotifierItem Support" in Extensions.

## Build from source

On Ubuntu 22.04+ / Zorin 17 (also works in WSL Ubuntu):

```bash
sudo apt update
sudo apt install -y build-essential curl wget file pkg-config patchelf \
  libwebkit2gtk-4.1-dev libgtk-3-dev libxdo-dev libssl-dev \
  libayatana-appindicator3-dev librsvg2-dev libdbus-1-dev
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh   # Rust
curl -fsSL https://bun.sh/install | bash                          # Bun (needs unzip)

bun install --frozen-lockfile
bun test
(cd src-tauri && cargo test --locked)
bun run tauri build --bundles deb,appimage
```

The packages land in `src-tauri/target/release/bundle/deb/` and `…/appimage/`. CI builds them on `ubuntu-22.04` (see `.github/workflows/release.yml`), so they run on Ubuntu 22.04 and newer.
