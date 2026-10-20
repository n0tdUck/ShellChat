// cmd.exe session through the native messaging host.
// Runs inside the background service worker; there is no page. An open native port also
// keeps the service worker alive (Chrome/Edge 105+), so the session doesn't get shut down.

const HOST_NAME = "com.example.cmd_bridge";

let port = null;
const outputListeners = new Set(); // bridge.js: everything cmd.exe prints
const statusListeners = new Set(); // background.js: connected / disconnected

function emitStatus() {
  statusListeners.forEach((f) => f(port !== null));
}

function connect() {
  let p;
  try {
    p = chrome.runtime.connectNative(HOST_NAME);
  } catch (e) {
    console.error("CMD Bridge: could not start the native host:", e);
    port = null;
    emitStatus();
    return;
  }
  port = p;
  console.log("CMD Bridge: connected to cmd.exe");
  emitStatus();

  p.onMessage.addListener((msg) => {
    let text = null;
    if (msg.type === "output" || msg.type === "error") text = msg.data;
    else if (msg.type === "exit") text = `\n[cmd.exe exited with code ${msg.code}]\n`;
    if (text !== null) outputListeners.forEach((f) => f(text));
  });

  p.onDisconnect.addListener(() => {
    const err = chrome.runtime.lastError;
    if (port !== p) return; // an older port we already replaced
    port = null;
    console.warn("CMD Bridge: cmd.exe disconnected" + (err ? `: ${err.message}` : "") +
                 ". Send /cmd-restart in the chat to start a new session.");
    emitStatus();
  });
}

function restart() {
  if (port) {
    const old = port;
    port = null;
    try {
      old.postMessage({ type: "kill" });
      old.disconnect();
    } catch { /* already gone */ }
  }
  console.log("CMD Bridge: starting new cmd.exe session...");
  connect();
}

export const terminal = {
  start: connect,
  isConnected: () => port !== null,
  run(cmd, who) {
    if (!port) return false;
    console.log(`CMD Bridge: [chat] ${who}: ${cmd}`);
    port.postMessage({ type: "input", data: cmd + "\r\n" });
    return true;
  },
  restart(who) {
    console.log(`CMD Bridge: [chat] ${who} restarted the session`);
    restart();
  },
  onOutput: (f) => outputListeners.add(f),
  onStatus: (f) => statusListeners.add(f),
};
