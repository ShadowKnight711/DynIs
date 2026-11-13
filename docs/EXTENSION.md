# DynIs Downloads & Media (browser extension)

The extension shows your **browser downloads** with exact progress, and **what's playing** on YouTube, YouTube Music, Spotify Web, Apple Music and SoundCloud (with the up next list) in the island. The island's play/pause, next, previous, seek and up next rows control the tab.

It talks only to the DynIs app on your PC (browser *native messaging*); nothing is sent over the internet. Only media information is read: title, artist or channel, artwork address, duration, position, playing state and the up next list. Each site can be turned off in **Settings → Browser**.

The extension ships inside DynIs, and setup walks you through installing it. It isn't in a browser store, so it's installed in Developer mode.

## Brave, Chrome, Edge (and Chromium, Vivaldi on Linux)

1. In DynIs, click **Open Browser** (setup or Settings → Browser). It opens the extensions page and the extension folder, and copies the folder path.
2. Turn on **Developer mode** (top right of the extensions page).
3. Click **Load unpacked**, paste the copied path, and choose the folder.
4. DynIs shows **Connected** after your first download or song.

**Updating:** after updating DynIs, click the reload arrow on the extension's card and accept any new site permissions.

## Firefox

1. In DynIs, choose **Firefox** and click **Open Firefox**. It opens `about:debugging` and the extension folder.
2. Click **Load Temporary Add-on…**, paste the copied path, and choose `manifest.json`.
3. If Firefox doesn't ask for the music sites, allow them in **Add-ons → DynIs Downloads & Media → Permissions**.

Release Firefox removes unsigned add-ons when it restarts. To keep it, sign it for free (unlisted) with your own Mozilla account:

```bash
npx web-ext sign --channel=unlisted --source-dir "<DynIs folder>/extension-firefox" --api-key <issuer> --api-secret <secret>
```

Each new extension version has to be signed again. Firefox 128 or newer is needed.

## What each site gives

| Site | Up next | Controls |
| --- | --- | --- |
| YouTube Music | The full queue | Play/pause, next, previous, seek, jump |
| YouTube | The playlist; otherwise the suggested videos | Play/pause, next (opens the next suggestion), previous, seek, jump |
| SoundCloud | Next Up, once it's been opened | Play/pause, next, previous, seek |
| Spotify Web Player | Only while its Queue panel is open | Play/pause, next, previous, seek |
| Apple Music | Usually none | Play/pause, next, previous, seek |
| Other sites (optional) | None | Play/pause, seek |

"Previous" restarts the song when it's more than 3 seconds in, otherwise it goes back.

## For developers

`extension/dynis-downloads` is the source. `media-core.js` holds the pure logic (tested in `src/webMediaCore.test.ts`), `content.js` reads the pages, and `background.js` picks the tab that is playing and talks to DynIs. The Firefox folder and `.xpi` are generated:

```bash
bun scripts/build-extension.mjs
```
