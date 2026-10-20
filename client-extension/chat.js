'use strict';

// WebSocket chat room, joined automatically from the background service worker (no page).
//
// Settings come from chrome.storage.local (serverUrl, name, room, token). Blank or missing
// values use the defaults below; a blank name gets a random nickname that is remembered so it
// stays the same across browser restarts. Changing a setting rejoins with the new values, e.g.
// from the service worker's DevTools console:
//   chrome.storage.local.set({ room: 'myroom', name: 'Duc' })

const DEFAULT_SERVER_URL = 'wss://websocket-chat-gs4x.onrender.com';
const DEFAULT_TOKEN = 'SSq3I16JuWNa4Xq+mzrPsouP1pf9aN88HUk7EwKKgoY=';
const NICK_ADJECTIVES = ['Swift', 'Quiet', 'Brave', 'Lucky', 'Clever', 'Sunny', 'Witty', 'Calm', 'Bold', 'Merry'];
const NICK_ANIMALS = ['Owl', 'Fox', 'Otter', 'Panda', 'Falcon', 'Badger', 'Koala', 'Lynx', 'Heron', 'Gecko'];
const DEFAULTS = { serverUrl: '', name: '', room: 'lobby', token: '' };
const SETTING_KEYS = Object.keys(DEFAULTS);
const MAX_RECONNECT_DELAY_MS = 30_000;
// Free hosts sleep after ~15 min without inbound messages, and Chrome stops an idle service
// worker after 30 s unless there is WebSocket traffic, so ping well inside both limits.
const KEEPALIVE_MS = 20_000;
const MAX_SEEN = 2000;

const messageListeners = new Set();
const leaveListeners = new Set();
const joinListeners = new Set();
const statusListeners = new Set();

const state = {
  settings: { ...DEFAULTS },
  ws: null,
  me: null,            // { id, name, room } from the server's welcome
  myIds: new Set(),    // every id we've had, so own messages survive reconnects
  seen: new Set(),     // message ids already handled, so replayed history is ignored
  joined: false,       // welcomed at least once since start() (reconnect vs. first join)
  online: false,       // currently connected and joined
  stopped: true,       // not trying to be in a room (stopped, or gave up after an error)
  retries: 0,
  retryTimer: null,
  status: 'stopped',   // 'connecting' | 'online' | 'reconnecting' | 'error' | 'stopped'
  error: null,
  userCount: 0,
};

// ---------- Start / stop ----------

async function start() {
  const saved = await chrome.storage.local.get({ ...DEFAULTS, generatedName: '' });
  const str = (v) => (typeof v === 'string' ? v : '');
  let name = str(saved.name).trim();
  if (!name) {
    name = str(saved.generatedName) || randomNickname();
    if (name !== saved.generatedName) await chrome.storage.local.set({ generatedName: name });
  }
  const settings = {
    serverUrl: str(saved.serverUrl).trim() || DEFAULT_SERVER_URL,
    name,
    room: str(saved.room).trim() || 'lobby',
    token: str(saved.token) || DEFAULT_TOKEN,
  };

  closeSocket();
  if (state.joined || state.online) fireLeave();
  state.settings = settings;
  state.joined = false;
  state.online = false;
  state.retries = 0;
  state.error = null;

  if (!/^wss?:\/\/\S+$/i.test(settings.serverUrl)) {
    return fail('serverUrl must start with ws:// or wss:// (for example ws://localhost:8080), or be blank for the default server.');
  }
  state.stopped = false;
  connect();
}

function stop() {
  state.stopped = true;
  closeSocket();
  const wasIn = state.joined || state.online;
  state.online = false;
  state.joined = false;
  if (wasIn) fireLeave();
  setStatus('stopped');
}

function closeSocket() {
  clearTimeout(state.retryTimer);
  const ws = state.ws;
  state.ws = null;
  if (ws) {
    try { ws.close(1000, 'Left'); } catch { /* ignore */ }
  }
}

function fireLeave() {
  leaveListeners.forEach((f) => f());
}

function randomNickname() {
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  return `${pick(NICK_ADJECTIVES)}${pick(NICK_ANIMALS)}${Math.floor(Math.random() * 1000)}`;
}

// ---------- Connection ----------

function connect() {
  clearTimeout(state.retryTimer);

  let ws;
  try {
    ws = new WebSocket(state.settings.serverUrl);
  } catch {
    return fail('That server URL is not valid.');
  }
  state.ws = ws;
  if (!state.joined) setStatus('connecting');

  ws.addEventListener('open', () => {
    const { name, room, token } = state.settings;
    ws.send(JSON.stringify({ type: 'join', name, room, token }));
  });

  ws.addEventListener('message', (e) => {
    let msg;
    try {
      msg = JSON.parse(e.data);
    } catch {
      return;
    }
    handleServerMessage(msg);
  });

  ws.addEventListener('close', (e) => {
    if (state.ws !== ws) return; // an older socket we already replaced
    state.ws = null;
    const wasOnline = state.online;
    state.online = false;

    if (state.stopped) return;
    if (e.code >= 4000 && e.code < 4100) return fail(e.reason || state.error || 'The server closed the connection.');
    if (wasOnline) console.warn('CMD Bridge: chat connection lost. Reconnecting…');
    scheduleReconnect();
  });
}

// Keeps retrying with backoff (up to 30 s apart). A sleeping free host can take about a
// minute to wake up, and there's no one watching to press "Join" again.
function scheduleReconnect() {
  const delay = Math.min(MAX_RECONNECT_DELAY_MS, 1000 * 2 ** state.retries) + Math.random() * 500;
  state.retries++;
  setStatus(state.joined ? 'reconnecting' : 'connecting');
  state.retryTimer = setTimeout(connect, delay);
}

setInterval(() => {
  if (state.online) state.ws.send(JSON.stringify({ type: 'ping' }));
}, KEEPALIVE_MS);

// Reconnect right away when the network comes back instead of waiting out the backoff.
self.addEventListener('online', () => {
  if (!state.stopped && !state.ws) {
    state.retries = 0;
    connect();
  }
});

// Rejoin when the settings change.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && SETTING_KEYS.some((k) => k in changes)) start();
});

function fail(message) {
  state.stopped = true;
  closeSocket();
  state.online = false;
  const wasIn = state.joined;
  state.joined = false;
  state.error = message;
  console.error('CMD Bridge: could not join the chat room:', message);
  if (wasIn) fireLeave();
  setStatus('error');
}

function handleServerMessage(msg) {
  switch (msg.type) {
    case 'welcome': return onWelcome(msg);
    case 'message': return onChat(msg);
    case 'system': return console.log(`CMD Bridge: [#${state.me?.room ?? state.settings.room}] ${msg.text}`);
    case 'users':
      state.userCount = msg.users.length;
      return setStatus(state.status);
    case 'error':
      state.error = msg.message;
      return console.warn('CMD Bridge: server error:', msg.message);
  }
}

// ---------- Incoming events ----------

function onWelcome({ you, users, history }) {
  const firstJoin = !state.joined;
  state.me = you;
  state.myIds.add(you.id);
  state.joined = true;
  state.online = true;
  state.retries = 0;
  state.error = null;
  state.userCount = users.length;

  if (firstJoin) state.seen.clear();
  history.forEach((m) => onChat(m, false));
  setStatus('online');

  if (firstJoin) {
    const renamed = you.name !== state.settings.name ? ` ("${state.settings.name}" was taken)` : '';
    console.log(`CMD Bridge: joined #${you.room} as ${you.name}${renamed}`);
    joinListeners.forEach((f) => f());   // joined a room (not fired on automatic reconnects)
  } else {
    console.log('CMD Bridge: reconnected');
  }
}

function onChat(msg, live = true) {
  if (state.seen.has(msg.id)) return;
  state.seen.add(msg.id);
  if (state.seen.size > MAX_SEEN) state.seen.delete(state.seen.values().next().value);

  const mine = state.myIds.has(msg.from.id);
  // Only live messages reach the bridge. History replayed on (re)join is never passed on,
  // so an old /cmd message can't run again after a reconnect.
  if (live) messageListeners.forEach((f) => f({ id: msg.id, text: msg.text, from: msg.from, mine }));
}

function setStatus(kind) {
  state.status = kind;
  statusListeners.forEach((f) => f(kind));
}

// ---------- API (used by bridge.js and background.js) ----------

export const chat = {
  start,
  stop,
  onMessage: (f) => messageListeners.add(f),
  onLeave: (f) => leaveListeners.add(f),
  onJoin: (f) => joinListeners.add(f),
  onStatus: (f) => statusListeners.add(f),
  status: () => state.status,
  error: () => state.error,
  userCount: () => state.userCount,
  isOnline: () => state.online,
  me: () => state.me,
  room: () => state.me?.room ?? state.settings.room,
  settings: () => ({ ...state.settings }),
  post(text) {
    if (!state.online) return false;
    state.ws.send(JSON.stringify({ type: 'message', text }));
    return true;
  },
  note: (text, isError = false) => (isError ? console.warn : console.log)('CMD Bridge:', text),
};
