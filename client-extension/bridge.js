'use strict';

// Chat -> cmd.exe bridge.
//
// While commands are ON (toolbar badge shows "ON"; click the toolbar button to switch),
// any message in the room that starts with /cmd is typed into the cmd.exe session, and what
// cmd.exe prints back is posted to the room as messages starting with 💻.
//
//   /cmd <command>    run a command (several lines = several commands)
//   /cmd-restart      restart cmd.exe (the only way to stop something like ping -t)
//
// Safety rules built in here:
//   - ON by default: switched on every time the room is joined (click the toolbar button to
//     turn it off for that visit). Switched off when the room is left.
//   - Refuses to switch on without an access key, unless the server is on this PC.
//   - Only live messages run. History the server replays on (re)join never runs (see chat.js).
//   - Output messages start with 💻, never with /cmd, so output can't trigger another command.

import { terminal as term } from './terminal.js';
import { chat } from './chat.js';

const CMD = '/cmd';
const RESTART = '/cmd-restart';
const OUT = '\u{1F4BB} ';          // "💻 ": marks cmd.exe output in the room
const MAX_CHUNK = 1900;            // server limit is 2000 characters per message
const FLUSH_IDLE_MS = 700;         // post output once cmd.exe has been quiet this long
const RELAY_IDLE_MS = 15_000;      // stop relaying after this long with no output
const MAX_CHUNKS_PER_CMD = 12;     // ~22k characters per command, then truncate
const POST_GAP_MS = 1300;          // server allows 10 messages per 10 s; leave room for your own

let enabled = false;
let relaying = false;     // currently forwarding output from a chat-issued command
let buffer = '';
let chunksSent = 0;
let truncated = false;
let flushTimer = null;
let relayTimer = null;
const queue = [];
let queueTimer = null;
let lastPost = 0;

// ---------- Switch ----------

const changeListeners = new Set();   // background.js: updates the toolbar badge
chat.onLeave(() => setEnabled(false, { quiet: true }));
// On by default: turn on as soon as we've joined. setEnabled still refuses (with a note in the
// service worker console) when a remote server has no access key; then you stay at "Commands off".
const ON_BY_DEFAULT = true;
chat.onJoin(() => { if (ON_BY_DEFAULT) setEnabled(true); });

function setEnabled(on, { quiet = false } = {}) {
  if (on === enabled) return;

  if (on) {
    if (!chat.isOnline()) return chat.note('Join a room before turning on commands.', true);
    const { serverUrl, token } = chat.settings();
    const local = isLocalServer(serverUrl);
    if (!token && !local) {
      return chat.note(
        'Commands need an access key. Start the chat server with CHAT_TOKEN set, then leave and rejoin ' +
        'with that key. Without one, anyone who finds the server could run commands on this PC.', true);
    }
    if (/^ws:\/\//i.test(serverUrl) && !local) {
      chat.note('Warning: ws:// is not encrypted, so the access key, commands and output can be read on the network. Use wss:// if you can.', true);
    }
  }

  enabled = on;
  render();

  if (on) {
    post(`${OUT}Commands are ON in #${chat.room()}. Anyone here can run cmd.exe commands on this PC:\n` +
         `${CMD} <command>   run a command\n` +
         `${RESTART}      restart cmd.exe (stops a running command)`);
    if (!term.isConnected()) post(`${OUT}cmd.exe isn't running right now. Send ${RESTART} to start it.`);
  } else {
    stopRelay({ flushFirst: false });
    queue.length = 0;
    if (!quiet) post(`${OUT}Commands are OFF.`);
  }
}

function render() {
  changeListeners.forEach((f) => f(enabled));
}

// ---------- Incoming chat -> cmd.exe ----------

chat.onMessage(({ text, from }) => {
  if (!enabled) return;
  const t = text.trim();

  if (t === RESTART) {
    term.restart(from.name);
    startRelay();
    return;
  }
  if (t !== CMD && !t.startsWith(CMD + ' ') && !t.startsWith(CMD + '\n')) return;

  const cmd = t.slice(CMD.length).trim();
  if (!cmd) {
    post(`${OUT}Usage: ${CMD} <command>   e.g. ${CMD} dir\n${RESTART} restarts cmd.exe.`);
    return;
  }
  if (!term.isConnected()) {
    post(`${OUT}cmd.exe isn't running. Send ${RESTART} to start it.`);
    return;
  }
  startRelay();
  for (const line of cmd.split('\n')) term.run(line.replace(/\r$/, ''), from.name);
});

// ---------- cmd.exe output -> chat ----------

term.onOutput((text) => {
  if (!enabled || !relaying || truncated) return;
  buffer += text.replace(/\r\n?/g, '\n');
  armRelayTimer();
  clearTimeout(flushTimer);
  if (buffer.length >= MAX_CHUNK) flush({ all: false });   // post full chunks now, keep the tail
  flushTimer = setTimeout(flush, FLUSH_IDLE_MS);
});

function startRelay() {
  if (!relaying) buffer = '';
  relaying = true;
  chunksSent = 0;
  truncated = false;
  armRelayTimer();
}

function stopRelay({ flushFirst }) {
  if (flushFirst) flush();
  relaying = false;
  buffer = '';
  clearTimeout(flushTimer);
  clearTimeout(relayTimer);
}

function armRelayTimer() {
  clearTimeout(relayTimer);
  relayTimer = setTimeout(() => stopRelay({ flushFirst: true }), RELAY_IDLE_MS);
}

function flush({ all = true } = {}) {
  clearTimeout(flushTimer);
  while (buffer && !truncated && (all || buffer.length >= MAX_CHUNK)) {
    let cut = buffer.length;
    if (cut > MAX_CHUNK) {
      const nl = buffer.lastIndexOf('\n', MAX_CHUNK);
      cut = nl > MAX_CHUNK / 2 ? nl + 1 : MAX_CHUNK;
    }
    const chunk = buffer.slice(0, cut).replace(/\s+$/, '');
    buffer = buffer.slice(cut);
    if (!chunk.trim()) continue;

    if (chunksSent >= MAX_CHUNKS_PER_CMD) {
      truncated = true;
      relaying = false;
      buffer = '';
      clearTimeout(relayTimer);
      post(`${OUT}[Output truncated after ${MAX_CHUNKS_PER_CMD} messages. ` +
           `The command may still be running; ${RESTART} stops it.]`);
      return;
    }
    chunksSent++;
    post(OUT + chunk);
  }
}

// ---------- Rate-limited posting ----------

function post(text) {
  queue.push(text);
  pump();
}

function pump() {
  if (queueTimer || queue.length === 0) return;
  const wait = Math.max(0, lastPost + POST_GAP_MS - Date.now());
  queueTimer = setTimeout(() => {
    queueTimer = null;
    if (!chat.isOnline()) {
      queue.length = 0;
      return;
    }
    chat.post(queue.shift());
    lastPost = Date.now();
    pump();
  }, wait);
}

// ---------- Helpers ----------

function isLocalServer(url) {
  try {
    const host = new URL(url).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
  } catch {
    return false;
  }
}

export const bridge = {
  isEnabled: () => enabled,
  setEnabled: (on) => setEnabled(on),
  onChange: (f) => changeListeners.add(f),
};

