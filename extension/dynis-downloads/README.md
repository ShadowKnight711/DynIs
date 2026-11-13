# DynIs Downloads & Media (browser extension)

Version 1.1.0 (DynIs 2.1) adds web media: what's playing on YouTube, YouTube
Music, Spotify, Apple Music and SoundCloud (and, if you allow it in the
extension's options, any other site using the Media Session API) shows in the
island with its up next list, and the island's play/pause, next, previous,
seek and up next rows control the tab. Only media information is read: title,
artist or channel, artwork address, duration, position, playing state and the
up next list. Each site can be turned off in DynIs → Settings → Browser.

Updating from 1.0: open the browser's extensions page and click the reload
arrow on DynIs Downloads, then accept the new site permissions.

`media-core.js` holds the pure logic (tested in `src/webMediaCore.test.ts`),
`content.js` reads the pages, `background.js` picks the tab that is playing
and talks to DynIs. The Firefox folder is generated from this one:
`bun scripts/build-extension.mjs`.

## Downloads

Shows your browser downloads with their exact progress in the DynIs island.
Works in Brave, Chrome and Edge (Firefox: see `../dynis-downloads-firefox`). It talks only to the DynIs app on this PC
(Chrome "native messaging"); nothing is sent over the internet, and only the
file name, byte counts and state are shared.

## Install (once)

1. Open `brave://extensions` (or `chrome://extensions`, `edge://extensions`).
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose this `dynis-downloads` folder.
4. Make sure DynIs 1.9.52 or newer is running. It registers itself with the
   browser on start, so the extension can reach it.

The extension's ID is fixed: `folieobmpnijgjlbildfpaikmlhiegfb` (see
`EXTENSION_ID.txt`). DynIs only accepts messages from that ID.

## Remove

Remove the extension from the browser's extensions page. Uninstalling DynIs
removes its browser registration too.
