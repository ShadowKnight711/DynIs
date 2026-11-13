# DynIs for Mac: build, install, test

DynIs 2.1 runs on macOS 12 (Monterey) or later, on Apple Silicon and Intel
Macs. The Mac app has to be built on a Mac. This page is for whoever builds
and tests it.

## 1. Build (about 10 minutes the first time)

1. Copy the whole DynIs folder to the Mac (zip it, or clone the repository).
2. Open **Terminal**, go into the folder, and run:

   ```bash
   bash scripts/build-mac.sh
   ```

   The script installs what's missing: Xcode Command Line Tools, Rust and
   Bun. If a window asks to install the Command Line Tools, click
   **Install**, wait for it to finish, then run the script again. It then
   runs the tests and builds the app.

3. When it finishes, it prints where the files are:
   - `src-tauri/target/universal-apple-darwin/release/bundle/dmg/DynIs_2.1.0_universal.dmg`
   - `src-tauri/target/universal-apple-darwin/release/bundle/macos/DynIs.app`

## 2. Install and open

1. Open the `.dmg` and drag **DynIs** to **Applications**.
2. The app isn't signed with an Apple Developer ID, so the first time macOS
   blocks it. Either:
   - right-click DynIs in Applications, choose **Open**, then **Open** again; or
   - run `xattr -dr com.apple.quarantine /Applications/DynIs.app` in Terminal.
3. Setup opens. The island appears when you click **Start DynIs**.

DynIs has no Dock icon. It lives in the island and the menu bar (the DynIs
icon has Settings and Quit).

## 3. Permissions macOS will ask for

| When | Prompt | Why |
|---|---|---|
| Music or Spotify is playing | "DynIs wants to control Music/Spotify" | Now Playing and the play/pause/next buttons. Click **OK**. |
| First Snap | Accessibility | Moving and resizing the window you were using. System Settings → Privacy & Security → Accessibility → turn on DynIs. |
| Keychain | "DynIs wants to use your confidential information" (sometimes) | Saving the Google Calendar or Spotify sign-in. Click **Always Allow**. |

If you clicked "Don't Allow" by mistake: System Settings → Privacy &
Security → Automation (or Accessibility) → turn DynIs on.

## 4. What works on Mac

| Feature | Mac | Notes |
|---|---|---|
| Island at the top, on every Space and over full-screen apps | ✅ | Above the menu bar. Clickable only over the island. |
| Wraps the notch (Classic style) | ✅ | On MacBooks with a notch the Classic island is at least as wide as the notch. Capsule style floats below it. |
| Now Playing: Apple Music and Spotify | ✅ | Title, artist, artwork, progress, play/pause, next, previous, seek, shuffle, repeat. |
| Now Playing: other players (Safari, Chrome, Podcasts…) | ❌ | macOS 15.4 closed the system "now playing" info to other apps. |
| Spotify extras (Up Next, likes, devices, add to queue) | ✅ | Same as Windows, after connecting Spotify. Premium is needed to control playback. |
| Battery and charging | ✅ | From `pmset`. |
| AirPods / Bluetooth headphones battery | ✅ | Checked every 30 seconds (from System Information). |
| Browser downloads (Brave, Chrome, Edge, Firefox) | ✅ | Same extension as Windows. DynIs registers itself with each installed browser on start. |
| Downloads folder | ✅ | `~/Downloads`. |
| Google Calendar | ✅ | Sign-in token in the Keychain. |
| Keep Awake | ✅ | Uses `caffeinate`. |
| Snap the window you were using | ✅ | Needs Accessibility. |
| Lock screen | ✅ | Sleeps the display; macOS asks for your password. |
| CPU, memory, disk, network, uptime, drives | ✅ | |
| Volume | ✅ | |
| Clipboard to Shelf | ✅ | Text only on Mac. |
| Widgets, to-dos, timer, Pomodoro, weather, search | ✅ | Same as Windows. |
| Reading other apps' notifications | ❌ | macOS doesn't allow it. Hidden on Mac. |
| Internet Download Manager | ❌ | Windows only. Hidden. |
| DynIs Dock | ❌ | macOS has its own Dock. Hidden. |
| Live blur material | ❌ | Hidden; Glass and Ink work. |
| Brightness, Wi-Fi and Bluetooth toggles | ❌ | No public macOS API. Hidden. |

## 5. What to check (for the tester)

Please try each of these and say ✅ or what went wrong (a screenshot helps):

1. Setup opens on first launch; the island appears after **Start DynIs**.
2. Hovering the island expands it; moving away collapses it; clicks on the
   rest of the menu bar still work.
3. Classic style on a notched MacBook: the island sits around the notch.
4. Play a song in Music, then in Spotify: title, artwork, and the buttons.
5. Unplug and plug in the charger: the battery updates within ~30 seconds.
6. Connect AirPods: their battery shows within ~30 seconds.
7. Widgets: Edit Widgets, add a few, drag to reorder.
8. Keep Awake on/off; Snap Left/Right on another app's window.
9. Download a file in your browser after loading the extension.
10. Full-screen an app and check the island still shows.

## 6. Build in the cloud instead (optional)

If DynIs is on GitHub, the **Build DynIs (Windows + macOS)** workflow
(`.github/workflows/build.yml`) builds both the Windows installer and the
Mac `.dmg`. Open the repository's **Actions** tab → the workflow →
**Run workflow**, and download the files from the finished run.

## Signing (later, optional)

To open without the warning, the app has to be signed with an Apple
Developer ID and notarized (Apple Developer Program, $99/year). Tauri
supports this with environment variables at build time; ask before doing it.
