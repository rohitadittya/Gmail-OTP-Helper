const views = {
  setup: document.getElementById("setup-view"),
  unlock: document.getElementById("unlock-view"),
  app: document.getElementById("app-view")
};
const message = document.getElementById("message");

function showMessage(text = "") { message.textContent = text; }
function showView(name) {
  for (const [key, view] of Object.entries(views)) view.hidden = key !== name;
  showMessage();
}

async function send(type, data = {}) {
  const result = await chrome.runtime.sendMessage({ type, ...data });
  if (!result?.ok) throw new Error(result?.error || "Something went wrong.");
  return result;
}

async function renderApp() {
  const state = await send("GET_STATE");
  const connected = state.connected;
  document.getElementById("gmail-label").textContent = connected ? "Gmail connected" : "Gmail not connected";
  document.getElementById("gmail-status").className = `status-dot ${connected ? "good" : "bad"}`;
  document.getElementById("connect-button").textContent = connected ? "Check Gmail now" : "Connect Gmail";
  document.getElementById("poll-status").textContent = connected
    ? scanSummary(state)
    : "Connect Gmail to start watching for new codes.";

  const list = document.getElementById("code-list");
  list.replaceChildren();
  if (!state.codes.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No recent codes. New matches will appear here.";
    list.append(empty);
  } else {
    for (const item of state.codes) list.append(makeCodeCard(item));
  }
}

function scanSummary(state) {
  if (state.lastScan?.error) return `Last Gmail scan failed: ${state.lastScan.error}`;
  if (state.lastScan) {
    const age = relativeTime(state.lastScan.at);
    if (state.lastScan.toastError) return `Gmail found ${state.lastScan.matches} code(s), but the browser toast failed: ${state.lastScan.toastError}`;
    return `Checking about every 5 seconds · Last scan ${age}: ${state.lastScan.messages} emails checked, ${state.lastScan.matches} code matches.`;
  }
  return `Checking about every 5 seconds${state.lastPoll ? ` · Last check ${relativeTime(state.lastPoll)}` : ""}`;
}

function relativeTime(timestamp) {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.floor(seconds / 60)}m ago`;
}

function makeCodeCard(item) {
  const card = document.createElement("article");
  card.className = "code-card";
  const top = document.createElement("div");
  top.className = "code-top";
  const service = document.createElement("div");
  service.className = "service";
  service.textContent = item.service || "Verification code";
  const copy = document.createElement("button");
  copy.className = "primary copy-button";
  copy.type = "button";
  copy.textContent = "Copy";
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(item.code);
      copy.textContent = "Copied";
      setTimeout(() => { copy.textContent = "Copy"; }, 1200);
    } catch { showMessage("Clipboard access failed. Select and copy the code manually."); }
  });
  top.append(service, copy);
  const code = document.createElement("div");
  code.className = "code";
  code.textContent = item.code;
  const age = document.createElement("div");
  age.className = "age";
  age.textContent = `${relativeTime(item.receivedAt)} · clears after 10 minutes`;
  card.append(top, code, age);
  return card;
}

async function initialize() {
  try {
    const state = await send("GET_STATE");
    if (!state.pinConfigured) showView("setup");
    else if (!state.unlocked) showView("unlock");
    else { showView("app"); await renderApp(); }
  } catch (error) { showMessage(error.message); }
}

document.getElementById("setup-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const pin = document.getElementById("new-pin").value;
  if (pin !== document.getElementById("confirm-pin").value) return showMessage("The PINs do not match.");
  try {
    await send("SET_PIN", { pin });
    showView("app");
    await renderApp();
  } catch (error) { showMessage(error.message); }
});

document.getElementById("unlock-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await send("UNLOCK", { pin: document.getElementById("pin").value });
    showView("app");
    await renderApp();
  } catch (error) { showMessage(error.message); }
});

document.getElementById("connect-button").addEventListener("click", async () => {
  const button = document.getElementById("connect-button");
  button.disabled = true;
  button.textContent = "Connecting…";
  try {
    await send("CONNECT_GMAIL");
    await renderApp();
    showMessage("Gmail connected. Looking for recent codes now.");
  } catch (error) { showMessage(error.message); }
  finally { button.disabled = false; }
});

document.getElementById("lock-button").addEventListener("click", async () => {
  await send("LOCK");
  showView("unlock");
});

chrome.runtime.onMessage.addListener((request) => {
  if (request.type === "CODES_UPDATED") renderApp().catch(() => {});
});

initialize();
