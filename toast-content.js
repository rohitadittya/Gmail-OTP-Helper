if (!globalThis.__gmailOtpToastListenerInstalled) {
  globalThis.__gmailOtpToastListenerInstalled = true;
  chrome.runtime.onMessage.addListener((request) => {
    if (request.type === "SHOW_OTP_TOAST") showOtpToast(request.code, request.label);
    if (request.type === "HIDE_OTP_TOAST") document.getElementById("gmail-otp-helper-browser-toast")?.remove();
  });
}

function showOtpToast(code, label) {
  const hostId = "gmail-otp-helper-browser-toast";
  document.getElementById(hostId)?.remove();

  const host = document.createElement("div");
  host.id = hostId;
  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = `
    :host { all: initial; }
    .toast { position: fixed; right: 22px; bottom: 22px; z-index: 2147483647; width: 320px; box-sizing: border-box;
      color: #f8fafc; background: #172033; border: 1px solid #34415a; border-radius: 14px;
      box-shadow: 0 14px 40px rgba(0,0,0,.28); font: 13px/1.4 Segoe UI,Arial,sans-serif; overflow: hidden;
      animation: enter .2s ease-out; }
    .content { padding: 14px 16px 12px; }
    .label { color: #aebbd0; font-size: 12px; margin-bottom: 7px; }
    .code { display: block; width: 100%; border: 0; padding: 0; color: #fff; background: transparent; text-align: left;
      font: 700 27px/1.25 Consolas,monospace; letter-spacing: 3px; cursor: pointer; }
    .hint { margin-top: 5px; color: #98a6bc; font-size: 11px; }
    .locked { font-size: 14px; font-weight: 650; }
    .timer { height: 3px; background: #3b82f6; transform-origin: left; animation: drain 10s linear forwards; }
    @keyframes drain { to { transform: scaleX(0); } }
    @keyframes enter { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  `;
  const card = document.createElement("div");
  card.className = "toast";
  const content = document.createElement("div");
  content.className = "content";
  const title = document.createElement("div");
  title.className = "label";
  title.textContent = label || "Gmail OTP Helper";
  content.append(title);

  if (code) {
    const codeButton = document.createElement("button");
    codeButton.className = "code";
    codeButton.type = "button";
    codeButton.textContent = code;
    const hint = document.createElement("div");
    hint.className = "hint";
    hint.textContent = "Click the code to copy";
    codeButton.addEventListener("click", async () => {
      codeButton.disabled = true;
      try {
        const authorization = await chrome.runtime.sendMessage({ type: "AUTHORIZE_TOAST_COPY", code });
        if (!authorization?.ok) throw new Error(authorization?.error || "The extension is locked.");
        await copyFromToast(code);
        codeButton.textContent = "Copied";
      } catch (error) {
        codeButton.disabled = false;
        codeButton.textContent = "Copy failed";
        hint.textContent = error.message || "Clipboard access failed";
        setTimeout(() => host.remove(), 2_000);
        return;
      }
      setTimeout(() => host.remove(), 350);
    });
    content.append(codeButton, hint);
  } else {
    const locked = document.createElement("div");
    locked.className = "locked";
    locked.textContent = "A code is ready. Unlock the extension to view it.";
    content.append(locked);
  }

  const timer = document.createElement("div");
  timer.className = "timer";
  card.append(content, timer);
  shadow.append(style, card);
  document.documentElement.append(host);
  setTimeout(() => host.remove(), 10_000);
}

async function copyFromToast(code) {
  try {
    await navigator.clipboard.writeText(code);
    return;
  } catch { /* Try the legacy clipboard path while the click still has user activation. */ }

  const textarea = document.createElement("textarea");
  textarea.value = code;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-10000px";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (copied) return;

  const result = await chrome.runtime.sendMessage({ type: "COPY_CODE_FROM_TOAST", code });
  if (!result?.ok) throw new Error(result?.error || "Clipboard access was denied.");
}
