# Bloom Settings Reference

All settings are stored in `settings.json` in the app config directory (`%APPDATA%/bloom/`). The file is a flat JSON object with `bloom-` prefixed keys. Bloom watches this file for external changes and applies them in real-time.

## Quick Start

Edit `settings.json` with any text editor while Bloom is running. Changes are applied immediately — no restart required.

```json
{
	"bloom-dock-enabled": "true",
	"bloom-dock-mode": "smart",
	"bloom-scale": "1.0"
}
```

## Settings Keys

### Dock

| Key                                | Type                             | Default       | Description                                                                                                                                                                      |
| ---------------------------------- | -------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bloom-dock-enabled`               | `"true"` / `"false"`             | `"true"`      | Show or hide the Bloom Dock (taskbar replacement).                                                                                                                               |
| `bloom-dock-mode`                  | `"fixed"` / `"smart"` / `"peek"` | `"smart"`     | Dock visibility behavior. **fixed** = always visible as AppBar. **smart** = auto-hide when overlapped by fullscreen apps. **peek** = hidden until cursor approaches bottom edge. |
| `bloom-dock-edge-delay`            | milliseconds `"0"`–`"2000"`      | `"200"`       | In smart/peek mode, how long the cursor must rest against the bottom screen edge before the dock appears. `"0"` reveals instantly.                                               |
| `bloom-dock-preview-enabled`       | `"true"` / `"false"`             | `"true"`      | Show window thumbnail previews when hovering dock icons.                                                                                                                         |
| `bloom-dock-icon-only`             | `"true"` / `"false"`             | `"false"`     | Minimal icon-only style (no background/padding around icons).                                                                                                                    |
| `bloom-dock-separator-enabled`     | `"true"` / `"false"`             | `"true"`      | Show a divider between pinned and unpinned dock apps when unpinned apps are present. Unpinned apps remain on the right when disabled.                                            |
| `bloom-start-icon`                 | icon key / `custom:<data URI>`   | `"default"`   | Start button icon: `default`, `bloom-colorful`, `bloom-golden`, `bloom-biscuit`, `windows`, or `custom:` followed by an uploaded image's data URI.                               |
| `bloom-dock-task-view`             | `"true"` / `"false"`             | `"false"`     | Show a Task View button beside Start that opens Task View, like the taskbar's. Right-click it to hide it again.                                                                  |
| `bloom-dock-adaptive`              | `"true"` / `"false"`             | `"false"`     | Fixed dock only. Stretch the dock to full width like a traditional taskbar while a window is maximized, and contract back when it's restored.                                    |
| `bloom-dock-win-number-enabled`    | `"true"` / `"false"`             | `"true"`      | When the taskbar is replaced, Win+1 through Win+9 activate the matching pinned dock app (focus/minimize if running, launch otherwise) instead of the native taskbar slots.       |
| `bloom-dock-extras-position`       | `"off"` / `"left"` / `"right"`   | `"off"`       | Show a dock extras section with drives, folders and the Recycle Bin beside the app icons, on the left or right side of the dock.                                                 |
| `bloom-dock-extras-drives`         | `"true"` / `"false"`             | `"true"`      | Show fixed, removable (with media) and connected mapped network drives in the dock extras. Empty card readers and unloaded discs are hidden.                                     |
| `bloom-dock-extras-hidden-drives`  | comma-separated letters          | `""`          | Drives left out of the dock extras, e.g. `"D,E"`. Drives not listed appear, including newly connected ones. Right-clicking a drive and choosing Remove from Dock adds it here. |
| `bloom-dock-extras-recycle-bin`    | `"true"` / `"false"`             | `"true"`      | Show the Recycle Bin in the dock extras. The icon reflects whether the bin holds anything.                                                                                       |
| `bloom-dock-extras-folders`        | comma-separated ids              | `"downloads"` | Known folders in the dock extras: any of `desktop`, `downloads`, `documents`, `pictures`, `music`, `videos`, or `"none"` for no folders.                                         |
| `bloom-dock-extras-custom-folders` | JSON array                       | `"[]"`        | User-added folders, e.g. `[{"name":"Projects","path":"D:\\Projects"}]`. Folders that no longer exist are skipped until they return.                                              |

### Notch

| Key                      | Type                             | Default   | Description                                                                                                                    |
| ------------------------ | -------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `bloom-notch-mode`       | `"smart"` / `"overlay"` / `"peek"` / `"fixed"` | `"smart"` | Notch visibility behavior. **smart** (default since 2.0.1) floats over windows and hides while a maximized or full-screen window covers it. **overlay** keeps it always visible without reserving screen space. **peek** shows the notch briefly on media events and notifications. **fixed** (Settings: Overlay → "Reserve Space") registers an AppBar that reserves a strip at the top of the screen, so maximized windows stay below the island and don't reach the top. Only fixed reserves space; switching away from it releases the strip immediately. |
| `bloom-notch-mode-chosen` | `"true"` | (unset) | Written when you pick a notch behavior in Settings or the island, so migrations keep a deliberate choice. |
| `bloom-settings-migrated-2.0.1` | `"true"` | (unset) | Internal. Set once the 2.0.1 migration ran: a `"fixed"` notch mode without `bloom-notch-mode-chosen` (the old default) became `"smart"`. |
| `bloom-island-style`     | `"pill"` / `"notch"` | `"pill"` | **pill**: floating capsule just off the edge. **notch**: the classic look, attached to the edge with flared corners. Applies live. |
| `bloom-island-material`  | `"ink"` / `"glass"` / `"glass-live"` | `"ink"` | Capsule style only. **ink**: solid black. **glass**: frosted translucent tint. **glass-live**: live blur of what is behind the island (only that area, 12-30 fps); DynIs is then hidden from screenshots, recordings and screen sharing. |
| `bloom-get-started-seen` | localStorage only | - | Set once the Settings "Get Started" page has been completed (reopen it from About). |
| `bloom-cc-layout`        | JSON array | built-in layout | Command Center controls in order: `[{"id","kind","size":"small"|"large","target"?,"label"?}]`. `kind` is a built-in control (`wifi`, `bluetooth`, `focus`, `volume`, …) or `app` / `file` with `target` = app path, file, folder or URL. Edited with the panel's "Edit Controls" button. |
| `bloom-activity-bluetooth` | `"true"` / `"false"` | `"true"` | Live activity when headphones or another Bluetooth device connects: name and battery %, when Windows reports it. |
| `bloom-activity-downloads` | `"true"` / `"false"` | `"true"` | Live activity for downloads in progress (browser `.crdownload` / `.part` files in the Downloads folder): name, size and speed. |
| `bloom-activity-clipboard` | `"true"` / `"false"` | `"false"` | Clipboard to Shelf: copied text and files are added to the shelf. Copies marked private (password managers) are skipped. The clipboard is not read while this is off. |
| `bloom-activity-notifications` | `"true"` / `"false"` | `"false"` | Other apps' notifications as island activities. Read-only from Windows' own per-user notification database (an undocumented Windows file, so a Windows update may break it). |
| `bloom-activity-custom` | `"true"` / `"false"` | `"true"` | Script activities: JSON files in `%LOCALAPPDATA%\com.kevin.dynis\activities\` (`{"title","value","state":"running|done|failed","progress"}`) show as pills. See `scripts/dynis-activity.ps1`. |
| `bloom-media-ignore-browsers` | `"true"` / `"false"` | `"false"` | Media follows the app you last played; when on, browser media sessions (Brave, Chrome, Edge, Firefox…) are never shown, including web media from the extension. |
| `bloom-web-media-sites` | JSON object | all on except `generic` | 2.1, Settings → Browser. Which sites the DynIs Downloads & Media extension may report media from: `{"youtube":true,"ytmusic":true,"spotify":true,"applemusic":true,"soundcloud":true,"generic":false}`. A site turned off is dropped by the extension and again by DynIs's native host. `generic` = any other site using the Media Session API (also needs the extension's optional "all sites" permission, from its options page). |
| `bloom-spotify-client-id` | string | `""` | 2.1. The Client ID of your own Spotify app (developer.spotify.com). Sign-in is PKCE, so there is no secret; the refresh token is kept in Windows Credential Manager (`DynIs/Spotify`), not here. |
| `bloom-activity-idm`     | `"true"` / `"false"` | `"true"` | Internet Download Manager downloads as activities (read-only: IDM's HKCU\Software\DownloadManager entries and its temp folder sizes). |
| `bloom-google-client-id` | string | `""` | Google OAuth client ID (Desktop app) for Google Calendar. |
| `bloom-google-client-secret` | string | `""` | The Desktop client's secret (Google treats desktop secrets as non-confidential). The sign-in token itself is kept in Windows Credential Manager, not here. |
| `bloom-todos`            | JSON array | `[]` | The Home view's to-do list: `[{"id","text","done"}]`. |
| `bloom-notch-edge`       | `"top"` / `"bottom"` | `"top"` | Screen edge the island is attached to. Bottom sits just above the dock or taskbar. Applies live. Retired `"left"`/`"right"` values are treated as `"top"`. |
| `bloom-notch-edge-delay` | milliseconds `"0"`–`"2000"`      | `"200"`   | In smart/peek mode, how long the cursor must rest against the top screen edge before the notch peeks. `"0"` reveals instantly. |

### Weather

| Key                              | Type                         | Default     | Description                                                                        |
| -------------------------------- | ---------------------------- | ----------- | ---------------------------------------------------------------------------------- |
| `bloom-weather-enabled`          | `"true"` / `"false"`         | `"true"`    | Show weather widget in the notch status bar.                                       |
| `bloom-weather-city`             | string                       | `""`        | Manually set city name for weather. Empty string = auto-detect via IP geolocation. |
| `bloom-weather-lat`              | number string                | (auto)      | Latitude coordinate for weather. Set automatically when a city is selected.        |
| `bloom-weather-lon`              | number string                | (auto)      | Longitude coordinate for weather. Set automatically when a city is selected.       |
| `bloom-weather-cached-temp`      | number string                | (none)      | Cached temperature value shown before next API fetch.                              |
| `bloom-weather-cached-condition` | string                       | (none)      | Cached weather condition text (e.g. "Partly Cloudy").                              |
| `bloom-temp-unit`                | `"celsius"` / `"fahrenheit"` | `"celsius"` | Temperature display unit.                                                          |

### Modules

| Key                         | Type                              | Default  | Description                                                                                              |
| --------------------------- | --------------------------------- | -------- | -------------------------------------------------------------------------------------------------------- |
| `bloom-calendar-enabled`    | `"true"` / `"false"`              | `"true"` | Enable calendar/timer mode in the notch.                                                                 |
| `bloom-timer-sound-enabled` | `"true"` / `"false"`             | `"true"` | Play a chime when the notch timer finishes.                                                              |
| `bloom-music-mode-enabled`  | `"true"` / `"false"`              | `"true"` | Enable interactive music media widget.                                                                   |
| `bloom-music-compact-notch` | `"true"` / `"false"`              | `"true"` | Show compact music display (visualizer + artwork) in collapsed notch.                                    |
| `bloom-notch-remember-panel` | `"true"` / `"false"` | `"true"` | Click opens the last-used panel when on; when off, click opens `bloom-notch-default-panel`. |
| `bloom-notch-default-panel` | `"calendar"` / `"command-center"` | `"calendar"` | Fixed panel opened on click when panel memory is off. If calendar is disabled, Command Center opens instead. |
| `bloom-notch-last-panel`    | `"calendar"` / `"command-center"` | (unset)  | Last panel the notch was left on, saved by Bloom while panel memory is on. |
| `bloom-notch-click-to-open` | `"true"` / `"false"` | (legacy) | Old setting read only when `bloom-notch-remember-panel` is absent; `"false"` now selects fixed-panel behavior. |

### Shelf

| Key                   | Type                 | Default   | Description                                                                                                    |
| --------------------- | -------------------- | --------- | -------------------------------------------------------------------------------------------------------------- |
| `bloom-shelf-persist` | `"true"` / `"false"` | `"false"` | Keep notch shelf items across restarts. Off = items are cleared when Bloom closes. Max 10 items, newest first. |

### Music Appearance

| Key                                | Type                      | Default     | Description                                                                                     |
| ---------------------------------- | ------------------------- | ----------- | ----------------------------------------------------------------------------------------------- |
| `bloom-media-layout`               | `"classic"` / `"compact"` | `"classic"` | Expanded player style. **classic** = large album art. **compact** = small thumbnail + controls. |
| `bloom-media-ambience-enabled`     | `"true"` / `"false"`      | `"true"`    | Colored ambient glow behind expanded album art.                                                 |
| `bloom-media-compact-glow-enabled` | `"true"` / `"false"`      | `"true"`    | Glow effect around the collapsed compact thumbnail.                                             |
| `bloom-media-visualizer-enabled`   | `"true"` / `"false"`      | `"true"`    | Audio visualizer bars in music mode. Also accepts `bloom-visualizer-enabled` (legacy alias).    |
| `bloom-media-album-art-enabled`    | `"true"` / `"false"`      | `"true"`    | Show album artwork in the notch music display.                                                  |

### Overlays

| Key                                | Type                 | Default  | Description                                                              |
| ---------------------------------- | -------------------- | -------- | ------------------------------------------------------------------------ |
| `bloom-volume-overlay-enabled`     | `"true"` / `"false"` | `"true"` | Show Bloom volume HUD when volume changes (replaces native Windows OSD). |
| `bloom-volume-edge-enabled`        | `"true"` / `"false"` | `"true"` | Trigger volume HUD by hovering the left screen edge.                     |
| `bloom-brightness-overlay-enabled` | `"true"` / `"false"` | `"true"` | Show Bloom brightness HUD when brightness changes.                       |
| `bloom-brightness-edge-enabled`    | `"true"` / `"false"` | `"true"` | Trigger brightness HUD by hovering the right screen edge.                |

### Appearance

DynIs is dark only (2.0.1). The `bloom-theme-mode`, `bloom-theme-color`, `bloom-theme-opacity`, `bloom-theme-saturation` and `bloom-theme-brightness` keys of the removed Light / Custom / Adaptive themes are deleted from `settings.json` at startup and ignored on import. The island material (`bloom-island-material`) is separate and unchanged.

| Key                      | Type                                             | Default     | Description                                                                                                                                                 |
| ------------------------ | ------------------------------------------------ | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bloom-corners-enabled`  | `"true"` / `"false"`                             | `"false"`   | Render rounded screen corner overlays on top edges.                                                                                                         |

### Status Widgets

| Key                    | Type        | Default                                    | Description                                                                                                 |
| ---------------------- | ----------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `bloom-status-widgets` | JSON string | `{"left":["weather"],"right":["battery"]}` | Widget layout in collapsed notch. Available: `"weather"`, `"battery"`, `"cpu"`, `"ram"`, `"disk"`, `"net"`. |

Example:

```json
{
	"bloom-status-widgets": "{\"left\":[\"cpu\",\"ram\"],\"right\":[\"battery\",\"net\"]}"
}
```

### System

| Key                            | Type                 | Default   | Description                                                                                          |
| ------------------------------ | -------------------- | --------- | ---------------------------------------------------------------------------------------------------- |
| `bloom-scale`                  | float string         | `"1.0"`   | UI scale factor (0.8 to 1.3). Changing this re-registers AppBars to resize the reserved screen area. |
| `bloom-low-battery-threshold`  | integer string       | `"20"`    | Battery percentage that triggers the low-battery alert pulse (5 to 50, step 5).                      |
| `bloom-auto-update`            | `"true"` / `"false"` | `"false"` | Check for and download updates automatically on startup.                                             |
| `bloom-show-update-indicator`  | `"true"` / `"false"` | `"true"`  | Show a green dot on the notch when an update is available.                                           |
| `bloom-announcement-dismissed` | announcement id      | `""`      | ID of the last dismissed in-app announcement (published via `website/public/announcements.json`).    |
| `bloom-time-format-24h`        | `"true"` / `"false"` | `"false"` | Use 24-hour clock format in the notch. When `"false"`, displays 12-hour format with AM/PM.           |

### Internal (Do Not Edit Manually)

| Key                 | Type     | Description                                                                           |
| ------------------- | -------- | ------------------------------------------------------------------------------------- |
| `bloom-first-run`   | sentinel | Set to `"done"` after first launch. Triggers splash screen if absent.                 |
| `bloom-app-version` | string   | Last known app version. If it differs from current, splash screen is shown on update. |

## Event System

Bloom uses two Tauri events for settings synchronization:

### `settings-changed`

- **Emitted by:** `save_setting` command (frontend or backend)
- **Payload:** `{ "key": "bloom-...", "value": ... }`
- **Purpose:** Broadcasts changes made through the Bloom UI to all windows
- **Key format:** Bloom-prefixed keys as-is (e.g. `"bloom-dock-mode"`)

### `settings-external-changed`

- **Emitted by:** File watcher (detects external edits to `settings.json`)
- **Payload:** `{ "key": "bloom-...", "value": ... }` or `{ "key": "bloom-...", "value": null }` for removed keys
- **Purpose:** Broadcasts changes made by external editors (VS Code, notepad, scripts)
- **Key format:** Bloom-prefixed keys as-is
- **Behavior:** Also syncs values to `localStorage` for instant frontend reads

### Flow

```
External editor saves settings.json
    ↓
File watcher detects change (ReadDirectoryChangesW)
    ↓
Diffs against SETTINGS_CACHE
    ↓
Emits settings-external-changed for each changed/removed key
    ↓
useSettingsSync hook updates React state + localStorage
    ↓
useSettingsSync hook updates React state
    ↓
UI re-renders with new values
```

## Example: Changing Dock Mode via Script

```powershell
# PowerShell: switch dock to smart mode
$json = Get-Content "$env:APPDATA\bloom\settings.json" | ConvertFrom-Json
$json.'bloom-dock-mode' = 'smart'
$json | ConvertTo-Json | Set-Content "$env:APPDATA\bloom\settings.json"
```

```python
# Python: disable dock
import json, os
path = os.path.join(os.environ['APPDATA'], 'bloom', 'settings.json')
with open(path) as f: settings = json.load(f)
settings['bloom-dock-enabled'] = 'false'
with open(path, 'w') as f: json.dump(settings, f)
```

## Notes

- All boolean values are strings (`"true"` / `"false"`) for consistency with `localStorage`.
- The `useSettingsSync` hook auto-converts `"true"` / `"false"` strings to booleans.
- `auto-hide` mode values in `bloom-dock-mode` and `bloom-notch-mode` are legacy aliases for `smart` — they are mapped automatically.
- Changing `bloom-scale` triggers AppBar re-registration to adjust reserved screen space.
- Settings → General → Reset to Defaults removes every `bloom-` key from `settings.json` and `localStorage` (except the `bloom-first-run` / `bloom-app-version` lifecycle sentinels), then restarts Bloom. Pinned apps (`pinned_apps.json`) and uploaded icons (`custom_icons/`) are preserved.
- `useSettingsSync` likewise mirrors every `settings-changed` value into `localStorage` before calling its handlers.

## Firefox: signing the downloads extension

Release Firefox keeps unsigned add-ons only until it restarts. To install
DynIs Downloads permanently, sign it with Mozilla. It's free, and "unlisted"
means it stays private (it isn't published on addons.mozilla.org). You do this
once, with your own account; DynIs never signs anything for you.

1. Sign in at https://addons.mozilla.org with a Firefox account.
2. Open Developer Hub → Manage API Keys and create a JWT issuer and secret.
   Keep them private.
3. Install Node.js, then run in a terminal:
   `npx web-ext sign --channel=unlisted --source-dir "<DynIs folder>\extension-firefox" --api-key <issuer> --api-secret <secret>`
   (`<DynIs folder>` is usually `%LOCALAPPDATA%\DynIs`.)
4. Mozilla checks it automatically, usually within minutes. web-ext saves a
   signed `.xpi` in `web-ext-artifacts`.
5. Drag that `.xpi` into Firefox and click Add. It now survives restarts.

The add-on ID is fixed (`downloads@dynis.kevin`); keep it, or DynIs won't
accept the connection. If you change the extension, raise `version` in its
`manifest.json` before signing again.
