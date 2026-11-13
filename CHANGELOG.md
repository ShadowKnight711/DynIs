# Changelog

## 2.1.0 (2026-11-12)
- Spotify: connect your own Spotify app (setup or Settings → Notch → Spotify) to get Up Next with artwork (click a song to skip to it), like and unlike, shuffle and repeat, seeking, choosing the device that plays, search (play now or add to the queue) and your playlists. Reading works on Spotify Free; controlling playback needs Premium. DynIs talks to Spotify only while Spotify is playing and the island is open.
- A step-by-step Spotify guide in setup and Settings, with a Copy button for the Redirect URI and fixes for the usual errors. The Google Calendar guide lists its usual errors too.
- Web media: the browser extension (now "DynIs Downloads & Media" 1.1.0) shows what's playing on YouTube, YouTube Music, Spotify, Apple Music and SoundCloud, labelled like "YouTube · Brave", with the up next list. Play/pause, next, previous (restarts the song after 3 seconds), seeking and the up next rows control the tab. It replaces the browser's own media entry, which had no queue. Optional: any other site that publishes what's playing.
- Settings → Browser: install the extension, check it's connected, and turn each site on or off. Only media information is read, and nothing leaves your PC.
- Reload the extension after updating (and sign the Firefox one again).
- DynIs for Linux (beta, Zorin OS 18 / Ubuntu 24.04+): a .deb and an AppImage. The island floats at the top of the screen on every workspace and steps aside for maximized and full-screen apps (Smart and Overlay; Linux never reserves screen space). Now playing for every MPRIS player (Spotify, Firefox, Chromium, Brave, Chrome, VLC, Rhythmbox…), battery and headphones battery, volume, screen brightness on laptops, Keep Awake, Snap, lock, clipboard, notifications (opt-in), system stats, Spotify, Google Calendar and the browser extension. Not on Linux: Internet Download Manager, live blur, the DynIs dock, and the Wi-Fi and Bluetooth panels.

## 2.0.1 (2026-11-10)
- Maximized windows use the whole screen again. The island now defaults to Smart: it floats over windows and steps aside for maximized and full-screen apps, without reserving a strip at the top. If you were on Fixed without choosing it, you're moved to Smart once.
- Fixed is now "Reserve Space (Windows Stay Below the Island)", under Notch → Overlay, for anyone who wants windows kept below the island. Turning it off gives the space back right away.
- DynIs is now dark only. The Light, Custom and Adaptive themes are gone, so the theme can no longer come out reversed, and anyone on another theme is back on Dark. Ink, Glass and Glass (live blur) are still there for the island.
- Material and other Settings changes apply instantly to the island, dock and Settings, with no restart, and each slider changes only its own setting.
- Weather's °C/°F and city now update in the island right away, and the music layout setting is remembered after a restart.

## 2.0.0 (2026-11-06)
- First-run setup: Welcome, then the browser extension, Google Calendar, Live Activities, and choosing Classic or Capsule with a material. The island appears when you finish, with a small hello.
- Editable Widgets: add, remove, reorder (drag), small or large, and a world clock with a time zone. Widgets: weather by hour, month progress, system status, to-dos, next events, shelf, timer, world clock, batteries.
- Weather widget fix: it no longer stays on "Loading", and shows "Couldn't load weather" with Retry when offline.
- Changelog in Settings, About.
- Widget gallery: a cleaner default (Weather, System, Month), Reset to Default, and 31 widgets by category — clocks, world clock, calendar month, day and year progress, countdown, sunrise and sunset, weather now, 5-day forecast, air quality, moon phase, quick note, Pomodoro, stopwatch, now playing, CPU and network graphs, storage, uptime, quick actions, app launcher, quote of the day and photo.
- Lighter and snappier: system stats, the clock and battery saver only update while you can see them, live blur stops while hidden, hidden Settings and dock windows use less memory, and setup loads on demand.
- Reorder widgets and controls with the keyboard: Space to pick up, arrows to move, Space to drop, Esc to cancel.
- Firefox support for browser downloads: a Firefox build of the DynIs Downloads extension, and setup shows the right steps for the browsers on your PC.
- Design pass (Apple guidelines): no text smaller than 11px, labels on every icon button, title-case buttons, Windows wording, clearer error messages, stronger edges with increased contrast, and a tray menu that only offers Open Setup and Quit during setup.

## 1.9.6 (2026-11-05)
- Headphones battery inside the pill, next to the PC battery.
- Internet Download Manager (IDM) downloads with exact progress.
- Google Calendar sign-in (read-only): dots on days with events, your next events, and a heads-up 10 minutes before.
- The top row no longer covers the time's arrows; thin scrollbars that appear on hover.
- "Open Apple Music" button removed; Home layout overlap fixed.
- You can type in the to-do field; scrolling lists no longer switches views; the island collapses again when you move away.
- Darker open Glass.

## 1.9.52 (2026-11-05)
- Bubbles in the order things started, centred with the pill, with a liquid split and merge.
- Glass (live blur).
- DynIs Downloads extension for Brave, Chrome and Edge with exact progress.
- Copy, then Keep, and Recent copies (images too).
- Command search (Ctrl+Alt+Space), Snap Window, Keep Awake, Widgets tab, Get Started page.
- Fixes: phantom downloads, stray browser media (plus "Ignore Browser Media"), stadium-shaped panels, bubble alignment, hover jitter, long video times. Lighter on CPU.

## 1.9.51 (2026-11-05)
- Island engine: live activities, a split bubble and short alerts.
- Classic Mac-notch look with soft shoulders and a liquid edge for music.
- Activities: charging, headphones, timer, downloads, clipboard to shelf, notifications.
- macOS-style Control Center and a wide Home view. Works with Apple Music.

## 1.9.5 (2026-11-05)
- Editable Command Center: add, remove, reorder, small or large tiles, and app, file or folder shortcuts.
- Glass material and lift-and-placeholder dragging.
- Darker panels, inset header, a more visible glass pill.

## 1.9.2
- Volume and brightness show inside the island.

## 1.9.1
- Capsule and Classic styles, corner fixes, and a restyled music view, Command Center and calendar.

## 1.9.0
- Redesign foundation: the black Ink capsule, Apple-style type and spacing, spring motion, accessibility fallbacks.

## 1.2.x
- Top or Bottom placement (Left and Right were removed).

## 1.0.0 (2026-11-04)
- DynIs is born, based on Bloom 3.10.1 (GPLv3): renamed, its own app ID, the updater and announcements removed, and the Overlay notch mode (always visible, doesn't shrink your windows).

---
Made by Kevin. Based on Bloom by Sehajveer Singh, licensed under GPLv3.
