const POLL_INTERVAL_MS = 5_000;
const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_CODES = 5;
const SEARCH_QUERY = "newer_than:1d {otp code verification security passcode}";

chrome.runtime.onInstalled.addListener(() => startFastPolling());
chrome.runtime.onStartup.addListener(async () => {
  await chrome.storage.session.clear();
  await stopFastPolling();
});
chrome.windows.onRemoved.addListener(async () => {
  const windows = await chrome.windows.getAll({ windowTypes: ["normal"] });
  if (windows.length === 0) {
    await chrome.storage.session.clear();
    await stopFastPolling();
  }
});
chrome.windows.onCreated.addListener(() => startFastPolling());

async function startFastPolling() {
  const { connected } = await chrome.storage.local.get("connected");
  const { unlocked } = await chrome.storage.session.get("unlocked");
  if (!connected || !unlocked) {
    await stopFastPolling();
    return;
  }
  await ensureOffscreenDocument();
  await chrome.runtime.sendMessage({ target: "offscreen", action: "START_POLLING", intervalMs: POLL_INTERVAL_MS });
}

async function stopFastPolling() {
  const url = chrome.runtime.getURL("offscreen.html");
  const contexts = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"], documentUrls: [url] });
  if (contexts.length) await chrome.runtime.sendMessage({ target: "offscreen", action: "STOP_POLLING" });
}

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  handleMessage(request).then(sendResponse).catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});

async function handleMessage(request) {
  switch (request.type) {
    case "GET_STATE": {
      const state = await getState();
      if (state.unlocked) await notifyPendingCodes(state.codes);
      return { ok: true, ...state };
    }
    case "SET_PIN": {
      const result = await setPin(request.pin);
      await startFastPolling();
      return result;
    }
    case "UNLOCK": {
      const result = await unlock(request.pin);
      if (result.ok) {
        await startFastPolling();
        await pollMailbox();
      }
      const state = await getState();
      await notifyPendingCodes(state.codes);
      return result;
    }
    case "LOCK":
      await chrome.storage.session.clear();
      await stopFastPolling();
      await hideBrowserToasts();
      return { ok: true };
    case "CONNECT_GMAIL": return connectGmail();
    case "POLL_MAILBOX": await pollMailbox(); return { ok: true };
    case "AUTHORIZE_TOAST_COPY": return authorizeToastCopy(request.code);
    case "COPY_CODE_FROM_TOAST": return copyToastCode(request.code);
    default: return { ok: false, error: "Unknown request." };
  }
}

async function getState() {
  const local = await chrome.storage.local.get(["pinSalt", "pinHash", "connected", "lastPoll", "lastScan"]);
  const session = await chrome.storage.session.get(["unlocked", "codes"]);
  const codes = (session.codes || []).filter((item) => Date.now() - item.receivedAt < CODE_TTL_MS);
  if (codes.length !== (session.codes || []).length) await chrome.storage.session.set({ codes });
  return {
    pinConfigured: Boolean(local.pinSalt && local.pinHash),
    unlocked: Boolean(session.unlocked),
    connected: Boolean(local.connected),
    lastPoll: local.lastPoll || null,
    lastScan: local.lastScan || null,
    codes: session.unlocked ? codes : []
  };
}

async function setPin(pin) {
  if (typeof pin !== "string" || pin.length < 8 || pin.length > 128) return { ok: false, error: "Use a PIN between 8 and 128 characters." };
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await hashPin(pin, salt);
  await chrome.storage.local.set({ pinSalt: toBase64(salt), pinHash: toBase64(hash) });
  await chrome.storage.local.remove(["pinFailedAttempts", "pinLockUntil"]);
  await chrome.storage.session.set({ unlocked: true, codes: [] });
  return { ok: true };
}

async function unlock(pin) {
  const { pinSalt, pinHash, pinFailedAttempts = 0, pinLockUntil = 0 } = await chrome.storage.local.get(["pinSalt", "pinHash", "pinFailedAttempts", "pinLockUntil"]);
  if (!pinSalt || !pinHash) return { ok: false, error: "Create a PIN first." };
  const remainingMs = pinLockUntil - Date.now();
  if (remainingMs > 0) return { ok: false, error: `Too many incorrect PIN attempts. Try again in ${Math.ceil(remainingMs / 1000)} seconds.` };
  const actual = await hashPin(pin, fromBase64(pinSalt));
  if (!constantTimeEqual(actual, fromBase64(pinHash))) {
    const failures = pinFailedAttempts + 1;
    const cooldownMs = failures >= 5 ? Math.min(15 * 60_000, 30_000 * (2 ** Math.floor((failures - 5) / 5))) : 0;
    await chrome.storage.local.set({ pinFailedAttempts: failures, pinLockUntil: Date.now() + cooldownMs });
    return { ok: false, error: cooldownMs ? `That PIN didn’t match. Try again in ${Math.ceil(cooldownMs / 1000)} seconds.` : "That PIN didn’t match." };
  }
  await chrome.storage.local.remove(["pinFailedAttempts", "pinLockUntil"]);
  await chrome.storage.session.set({ unlocked: true });
  return { ok: true };
}

async function hashPin(pin, salt) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 250000, hash: "SHA-256" }, key, 256);
  return new Uint8Array(bits);
}

function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left[i] ^ right[i];
  return diff === 0;
}

function toBase64(bytes) { return btoa(String.fromCharCode(...bytes)); }
function fromBase64(text) { return Uint8Array.from(atob(text), (char) => char.charCodeAt(0)); }

async function connectGmail() {
  let token;
  try {
    const authResult = await chrome.identity.getAuthToken({ interactive: true });
    token = typeof authResult === "string" ? authResult : authResult?.token;
    if (!token) throw new Error("Chrome did not return a Gmail access token.");
    const profile = await gmailRequest("https://gmail.googleapis.com/gmail/v1/users/me/profile", token);
    await chrome.storage.local.set({
      connected: true,
      emailAddress: profile.emailAddress,
      lastPoll: Date.now() - 24 * 60 * 60 * 1000,
      processedIds: []
    });
    await startFastPolling();
    await pollMailbox();
    return { ok: true };
  } catch (error) {
    if (token) await chrome.identity.removeCachedAuthToken({ token }).catch(() => {});
    throw new Error(error.message || "Could not connect to Gmail.");
  }
}

async function getToken() {
  const result = await chrome.identity.getAuthToken({ interactive: false });
  return typeof result === "string" ? result : result?.token;
}

async function gmailRequest(url, token) {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (response.status === 401) throw new Error("Gmail authorization expired. Reconnect Gmail from the extension.");
  if (!response.ok) throw new Error(`Gmail request failed (${response.status}).`);
  return response.json();
}

async function pollMailbox() {
  const { unlocked } = await chrome.storage.session.get("unlocked");
  if (!unlocked) return;
  const { connected, lastPoll } = await chrome.storage.local.get(["connected", "lastPoll"]);
  if (!connected) return;
  let token;
  try {
    token = await getToken();
    const since = Math.max(0, Math.floor(((lastPoll || Date.now() - 5 * 60 * 1000) - 60_000) / 1000));
    const query = new URLSearchParams({ q: `${SEARCH_QUERY} after:${since}`, maxResults: "20" });
    const list = await gmailRequest(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${query}`, token);
    if (!(await chrome.storage.session.get("unlocked")).unlocked) return;
    const { processedIds = [] } = await chrome.storage.local.get("processedIds");
    const seen = new Set(processedIds);
    const fresh = [];
    for (const message of list.messages || []) {
      if (!(await chrome.storage.session.get("unlocked")).unlocked) return;
      if (seen.has(message.id)) continue;
      seen.add(message.id);
      const full = await gmailRequest(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(message.id)}?format=full`, token);
      const candidate = extractCandidate(full);
      if (candidate && Date.now() - candidate.receivedAt < CODE_TTL_MS) fresh.push(candidate);
    }
    const session = await chrome.storage.session.get(["unlocked", "codes"]);
    const codes = (session.codes || []).filter((item) => Date.now() - item.receivedAt < CODE_TTL_MS);
    await chrome.storage.session.set({ codes: codes.slice(0, MAX_CODES) });
    await chrome.storage.local.set({
      processedIds: [...seen].slice(-200),
      lastPoll: Date.now(),
      lastScan: { at: Date.now(), messages: (list.messages || []).length, matches: fresh.length, error: null }
    });
    for (const item of fresh) {
      if (!codes.some((existing) => existing.messageId === item.messageId)) codes.unshift(item);
    }
    await chrome.storage.session.set({ codes: codes.slice(0, MAX_CODES) });
    if (session.unlocked) await notifyPendingCodes(codes.slice(0, MAX_CODES));
    else if (fresh.length) {
      await showBrowserToast(null, "A verification code is ready. Unlock the extension to view it.");
    }
    chrome.runtime.sendMessage({ type: "CODES_UPDATED" }).catch(() => {});
  } catch (error) {
    await pruneExpiredCodes();
    await chrome.storage.local.set({ lastScan: { at: Date.now(), messages: 0, matches: 0, error: (error.message || "Gmail scan failed.").slice(0, 180) } });
    if (error.message.includes("authorization expired")) await chrome.storage.local.set({ connected: false });
  }
}

function decodeBase64Url(value) {
  if (!value) return "";
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  try { return new TextDecoder().decode(Uint8Array.from(atob(normalized), (char) => char.charCodeAt(0))); }
  catch { return ""; }
}

function collectBody(part, output) {
  if (part.body?.data) output.push(decodeBase64Url(part.body.data));
  for (const child of part.parts || []) collectBody(child, output);
}

function extractCandidate(message) {
  const body = [];
  collectBody(message.payload || {}, body);
  const headers = message.payload?.headers || [];
  const header = (name) => headers.find((item) => item.name?.toLowerCase() === name)?.value || "";
  const subject = header("subject");
  const sender = header("from");
  const content = `${subject}\n${message.snippet || ""}\n${body.join("\n")}`.replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&");
  if (!/(otp|one[- ]time|verification|security|sign[- ]in|authentication|login|passcode|confirmation code|code requested)/i.test(content)) return null;
  const patterns = [
    /(?:code|otp|passcode|verification code|security code|one[- ]time code|sign[- ]in code)[^\d]{0,30}(\d(?:[\s-]?\d){3,7})/i,
    /\b(\d{4,8})\b/
  ];
  let code = null;
  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match) { code = match[1].replace(/[\s-]/g, ""); break; }
  }
  if (!code) return null;
  const receivedAt = Number(message.internalDate) || Date.now();
  return { messageId: message.id, code, service: cleanService(sender, subject), receivedAt };
}

function cleanService(sender, subject) {
  const name = sender.match(/^\s*([^<]+)</)?.[1]?.replace(/"/g, "").trim();
  if (name) return name.slice(0, 50);
  const domain = sender.match(/@([^>\s]+)/)?.[1];
  return domain || subject.slice(0, 50) || "Verification code";
}

async function notifyPendingCodes(codes) {
  const { browserToastShownIds = [] } = await chrome.storage.session.get("browserToastShownIds");
  const validIds = new Set(codes.map((item) => item.messageId));
  const delivered = new Set(browserToastShownIds.filter((id) => validIds.has(id)));
  let changed = false;
  for (const item of codes) {
    if (delivered.has(item.messageId)) continue;
    try {
      const shown = await showBrowserToast(item.code, `${item.service} verification code`);
      if (shown) {
        delivered.add(item.messageId);
        changed = true;
      }
    } catch (notificationError) {
      const { lastScan = {} } = await chrome.storage.local.get("lastScan");
      await chrome.storage.local.set({ lastScan: { ...lastScan, toastError: (notificationError.message || "Browser toast failed.").slice(0, 180) } });
    }
  }
  if (changed) await chrome.storage.session.set({ browserToastShownIds: [...delivered] });
}

async function pruneExpiredCodes() {
  const { codes = [] } = await chrome.storage.session.get("codes");
  const current = codes.filter((item) => Date.now() - item.receivedAt < CODE_TTL_MS);
  if (current.length !== codes.length) await chrome.storage.session.set({ codes: current });
}

async function showBrowserToast(code, label) {
  if (code && !(await authorizeToastCopy(code)).ok) return false;
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id || !/^https?:\/\//i.test(tab.url || "")) return false;
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["toast-content.js"] });
  if (code && !(await authorizeToastCopy(code)).ok) {
    await chrome.tabs.sendMessage(tab.id, { type: "HIDE_OTP_TOAST" }).catch(() => {});
    return false;
  }
  await chrome.tabs.sendMessage(tab.id, { type: "SHOW_OTP_TOAST", code, label });
  return true;
}

async function copyToastCode(code) {
  const authorization = await authorizeToastCopy(code);
  if (!authorization.ok) return authorization;
  await ensureOffscreenDocument();
  const response = await chrome.runtime.sendMessage({ target: "offscreen", action: "COPY_CODE", code });
  if (!response?.ok) throw new Error(response?.error || "Could not copy the code.");
  return { ok: true };
}

async function authorizeToastCopy(code) {
  if (typeof code !== "string" || !/^\d{4,8}$/.test(code)) return { ok: false, error: "Invalid code." };
  const { unlocked, codes = [] } = await chrome.storage.session.get(["unlocked", "codes"]);
  if (!unlocked) return { ok: false, error: "Unlock the extension before copying a code." };
  const current = codes.some((item) => item.code === code && Date.now() - item.receivedAt < CODE_TTL_MS);
  if (!current) return { ok: false, error: "This code has expired or is no longer available." };
  return { ok: true };
}

async function hideBrowserToasts() {
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.filter((tab) => tab.id).map((tab) =>
    chrome.tabs.sendMessage(tab.id, { type: "HIDE_OTP_TOAST" }).catch(() => {})
  ));
}

async function ensureOffscreenDocument() {
  const url = chrome.runtime.getURL("offscreen.html");
  const contexts = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"], documentUrls: [url] });
  if (contexts.length === 0) {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["CLIPBOARD"],
      justification: "Copy an OTP when the user clicks its in-browser toast."
    });
  }
}

