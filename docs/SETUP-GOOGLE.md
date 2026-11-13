# Connect Google Calendar

DynIs reads your calendar (read-only) with **your own** Google Cloud OAuth client. It takes about five minutes. The same guide is in DynIs: setup → Connect Google Calendar, and **Settings → Notch → Google Calendar**.

## Steps

1. Open **[console.cloud.google.com](https://console.cloud.google.com)** and create a project named "DynIs".
2. **APIs & Services → Library** → enable **Google Calendar API**.
3. **OAuth consent screen:** External, app name "DynIs", and add your Google account as a **test user**.
4. **Credentials → Create credentials → OAuth client ID → Desktop app.**
5. Paste the **Client ID** and **Client secret** into DynIs, then click **Connect** and approve in the browser.

Google treats a desktop app's secret as non-confidential; it's stored in DynIs's settings on your PC. The sign-in token itself is kept in Windows Credential Manager (or the Secret Service on Linux).

## If something goes wrong

| Message | Fix |
| --- | --- |
| `Access blocked: DynIs has not completed the Google verification process` | Add your Google account under **OAuth consent screen → Test users**, then connect again. |
| `Error 400: redirect_uri_mismatch` | The OAuth client must be of type **Desktop app**. Create one of that type and paste its ID and secret. |
| `Google Calendar API has not been used in project…` | Enable **Google Calendar API** in **APIs & Services → Library** for the same project. |
