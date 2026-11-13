# Connect Spotify

DynIs talks to Spotify with **your own** Spotify app, so there's no shared key and no DynIs server. It takes about three minutes. The same guide is in DynIs: setup → Connect Spotify, and **Settings → Notch → Spotify**.

## Steps

1. Go to **[developer.spotify.com/dashboard](https://developer.spotify.com/dashboard)** and log in with your Spotify account.
2. Click **Create app**. Any name and description work, for example "DynIs".
3. Under **Redirect URIs**, add this address exactly and click **Add**:

   ```
   http://127.0.0.1:47819/callback
   ```

4. Under "Which API/SDKs are you planning to use?", tick **Web API**, accept the terms, and click **Save**.
5. Open the app's **Settings** and copy the **Client ID**. No secret is needed.
6. Paste it into DynIs, click **Connect**, and approve in the browser window that opens.

## Good to know

- **Free vs Premium:** reading (Up Next, likes, playlists) works on Spotify Free. Controlling playback from DynIs (skip, seek, shuffle, devices, play) needs Spotify Premium; that's Spotify's rule.
- **Friends using your Client ID:** new Spotify apps are in *development mode*. Add each person's Spotify email under your app → **Settings → User Management**. Development mode allows only a small number of users.
- **Disconnect:** Settings → Notch → Spotify → **Disconnect**. Your sign-in token is kept in Windows Credential Manager (or the Secret Service / GNOME Keyring on Linux) and is removed there.
- DynIs only calls Spotify while the Spotify app is the player and the island is open.

## If something goes wrong

| Message | Fix |
| --- | --- |
| `INVALID_CLIENT: Invalid redirect URI` | The Redirect URI must match exactly, including `http`, `127.0.0.1` and the port. Add it again and click **Save**. |
| `User not registered in the Developer Dashboard` | Add the Spotify account's email under **User Management** in your app's settings. |
| `INVALID_CLIENT: Invalid client` | The Client ID was copied incompletely. It's 32 letters and numbers. |
| `Port 47819 is busy` | Another app uses that port. Close it or restart, then click **Connect** again. |
