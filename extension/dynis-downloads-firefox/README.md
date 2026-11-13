# DynIs Downloads & Media for Firefox

The same extension as `dynis-downloads`, packaged for Firefox 128 or newer.
Add-on ID: `downloads@dynis.kevin`. DynIs only accepts messages from that ID.
Don't edit the files here: they're copied from `../dynis-downloads` by
`bun scripts/build-extension.mjs`, which also rebuilds the `.xpi`.

Since 1.1.0 (DynIs 2.1) it also shows what's playing on YouTube, YouTube
Music, Spotify, Apple Music and SoundCloud. If Firefox doesn't ask for those
sites when installing, allow them in Add-ons → DynIs Downloads & Media →
Permissions.

## Try it now (until Firefox restarts)

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…** and choose `manifest.json` in this folder
   (or `dynis-downloads-firefox.xpi`).
3. Keep DynIs running. It registers itself with Firefox on start.

Release Firefox removes temporary add-ons when it restarts.

## Keep it permanently

Release Firefox only installs add-ons signed by Mozilla. Signing is free and
the add-on stays private ("unlisted"). See "Firefox: signing the downloads
extension" in SETTINGS.md. Each new version (like 1.1.0) has to be signed
again.
