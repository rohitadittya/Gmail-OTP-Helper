# Gmail OTP Helper

Gmail OTP Helper is a personal Chrome extension that finds recent one-time verification codes in Gmail. It shows codes in a small toast inside the active webpage and in the extension’s manual view. Clicking a toast code copies it to the clipboard.

## 1. What this app does

- Connects to Gmail with Google OAuth and the `gmail.readonly` scope.
- Checks recent emails for OTP-related wording and numeric codes.
- Uses a PIN to protect codes for a single Chrome session.
- Displays codes in an in-browser toast or the extension view.

It does not read SMS, send email, or use a cloud backend.

## 2. How to use it

### First-time Google setup

The Chrome extension ID is needed to create the OAuth client. If you already loaded this extension, find its ID in `chrome://extensions` and skip to step 4.

1. In PowerShell, go to the project folder and copy the example environment file only if `.env` does not already exist:

   ```powershell
   cd "C:\path\to\Gmail-OTP-Helper"
   if (-not (Test-Path .env)) { Copy-Item .env.example .env }
   ```

2. Build once using the placeholder ID in `.env.example` (use the PowerShell command in **Build the manifest** below). This creates a manifest that lets Chrome load the unpacked extension so you can find its ID. Do not connect Gmail yet.
3. Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select the project folder. Copy the 32-character ID shown on the extension card. Keep the folder in the same location; moving an unpacked extension can change its ID.
4. In the [Google Cloud Console](https://console.cloud.google.com/), select or create a project. Go to **APIs & Services → Library**, search for **Gmail API**, and enable it.
5. Open **Google Auth Platform → Branding** and configure the app. Under **Audience**, choose the appropriate user type; for a personal testing app, add your Google account as a test user.
6. Go to **Google Auth Platform → Clients → Create client**. Choose **Chrome Extension**, enter a name, and paste the extension ID into **Item ID**. Click **Create**.
7. Copy the new OAuth client ID ending in `.apps.googleusercontent.com` into `.env` as `GOOGLE_OAUTH_CLIENT_ID`, then build again and reload the extension in `chrome://extensions`.

Google’s [OAuth credential guide](https://developers.google.com/workspace/guides/create-credentials) documents the Chrome Extension client setup. The client’s Item ID must match the extension ID shown by Chrome.

### Build the manifest

Chrome requires a literal OAuth client ID in `manifest.json`; it cannot read `.env` directly. From PowerShell, run:

```powershell
cd "C:\path\to\Gmail-OTP-Helper"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\build.ps1"
```

Replace `C:\path\to\Gmail-OTP-Helper` with the folder where you saved the project. The script prints `Generated manifest.json. Load this folder in Chrome.` Run it again whenever the OAuth client ID or manifest template changes.

### Load and use the extension

1. In `chrome://extensions`, click **Load unpacked** and select the project folder. If already loaded, click its **Reload** button after rebuilding or changing extension code.
2. Approve the requested site access. The extension needs access to regular webpages to show the in-page toast.
3. Open the extension, create your PIN, and connect Gmail.
4. Keep Chrome open and the extension unlocked for automatic polling. Click the extension icon to view codes, use **Check Gmail now** for a manual check, or choose **Lock extension** to stop polling and hide codes.

## 3. Environment variables

The local `.env` file contains:

```text
GOOGLE_OAUTH_CLIENT_ID=your-client-id.apps.googleusercontent.com
```

## 4. Features and current behavior

1. **5-second polling:** The extension checks Gmail about every five seconds while active. Chrome or Gmail can still delay when a message becomes available.
2. **Unlocked-only polling:** Polling runs only when the extension is unlocked and Chrome has a normal browser window open. Locking stops the timer. Unlocking restarts it and checks Gmail immediately.
3. **Manual lock:** **Lock extension** stops polling, clears the current session’s codes and unlock state, and removes visible code toasts across open tabs. Five incorrect PIN attempts trigger a cooldown that grows with repeated failures.
4. **In-browser toast:** A toast appears in the active regular `http` or `https` webpage. When unlocked, click the code to copy it. The toast disappears after ten seconds. While locked, it hides the code and says one is ready. Chrome internal pages and other restricted pages cannot host the toast.
5. **Manual viewing and polling:** Click the extension icon to view recent codes. Click **Check Gmail now** to run a manual Gmail check.

## 5. Where codes are stored and how they’re cleared

- Code values are held in Chrome extension `storage.session`. They are not stored in `storage.local` or sent to a backend.
- The extension keeps at most five recent codes and removes them from its session after ten minutes.
- Manual lock clears session codes and the unlock state, and removes visible toasts. Closing the last normal Chrome window also clears the session; Chrome clears it on browser restart or extension reload.
- Clicking a toast copies the code to the Windows clipboard. The extension does not clear the clipboard; the code remains there until replaced or cleared by you.
- The PIN itself is not stored. A salted PBKDF2 verifier is saved in `storage.local`. Local scan metadata, including processed message IDs and scan status, is also stored there.

## Security notes

The PIN is a display barrier, not a substitute for Windows account security. The extension briefly reads Gmail message content to detect codes. You can revoke its Gmail access in your Google Account security settings. The toast requires access to regular web pages and does not run on Chrome internal pages.
