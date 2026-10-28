let pollTimer = null;
let pollInFlight = false;

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.target !== "offscreen") return;
  if (request.action === "START_POLLING") {
    clearInterval(pollTimer);
    const intervalMs = Math.max(5_000, Number(request.intervalMs) || 5_000);
    pollTimer = setInterval(async () => {
      if (pollInFlight) return;
      pollInFlight = true;
      try { await chrome.runtime.sendMessage({ type: "POLL_MAILBOX" }); }
      catch { /* The next interval retries after the service worker wakes. */ }
      finally { pollInFlight = false; }
    }, intervalMs);
    sendResponse({ ok: true });
    return;
  }
  if (request.action === "STOP_POLLING") {
    clearInterval(pollTimer);
    pollTimer = null;
    sendResponse({ ok: true });
    return;
  }
  if (request.action === "COPY_CODE") {
    copyInOffscreen(request.code).then(
      () => sendResponse({ ok: true }),
      (error) => sendResponse({ ok: false, error: error.message || "Clipboard access failed." })
    );
    return true;
  }
});

async function copyInOffscreen(code) {
  try {
    await navigator.clipboard.writeText(code);
    return;
  } catch { /* Fall back to the extension clipboard permission via execCommand. */ }

  const textarea = document.createElement("textarea");
  textarea.value = code;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-10000px";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("Clipboard access was denied by Chrome.");
}
