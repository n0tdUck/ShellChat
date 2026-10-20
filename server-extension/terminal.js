// Terminal pane: a cmd.exe session through the native messaging host.
(() => {
  const HOST_NAME = "com.example.cmd_bridge";

  const output = document.getElementById("term-output");
  const input = document.getElementById("term-input");
  const form = document.getElementById("term-form");
  const statusEl = document.getElementById("term-status");

  let port = null;
  const history = [];
  let historyIndex = 0;
  const outputListeners = new Set();     // bridge.js: everything cmd.exe prints
  const localInputListeners = new Set(); // bridge.js: commands typed in this tab's input box
  let stickToBottom = true; // remembered while the pane is hidden (hidden elements have no scroll size)

  function isVisible() {
    return window.isPaneActive?.("terminal") ?? true;
  }

  function append(text, cls) {
    const visible = isVisible();
    const atBottom = visible
      ? output.scrollHeight - output.scrollTop - output.clientHeight < 40
      : stickToBottom;
    if (cls) {
      const span = document.createElement("span");
      span.className = cls;
      span.textContent = text;
      output.appendChild(span);
    } else {
      output.appendChild(document.createTextNode(text));
    }
    if (visible && atBottom) output.scrollTop = output.scrollHeight;
    if (!visible) window.notifyPane?.("terminal");
  }

  function setStatus(connected) {
    statusEl.textContent = connected ? "Connected to cmd.exe" : "Disconnected";
    statusEl.className = "term-status " + (connected ? "on" : "off");
  }

  function connect() {
    port = chrome.runtime.connectNative(HOST_NAME);
    setStatus(true);

    port.onMessage.addListener((msg) => {
      let text = null;
      if (msg.type === "output") append((text = msg.data));
      else if (msg.type === "error") append((text = msg.data), "err");
      else if (msg.type === "exit") append((text = `\n[cmd.exe exited with code ${msg.code}]\n`), "sys");
      if (text !== null) outputListeners.forEach((f) => f(text));
    });

    port.onDisconnect.addListener(() => {
      const err = chrome.runtime.lastError;
      if (err) append(`\n[Native host error: ${err.message}]\n`, "err");
      append("[Disconnected. Click Restart to start a new session.]\n", "sys");
      port = null;
      setStatus(false);
    });
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const cmd = input.value;
    if (!port) {
      append("[Not connected. Click Restart.]\n", "sys");
      return;
    }
    port.postMessage({ type: "input", data: cmd + "\r\n" });
    localInputListeners.forEach((f) => f(cmd));
    if (cmd.trim()) history.push(cmd);
    historyIndex = history.length;
    input.value = "";
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowUp" && historyIndex > 0) {
      historyIndex--;
      input.value = history[historyIndex];
      e.preventDefault();
    } else if (e.key === "ArrowDown") {
      historyIndex = Math.min(historyIndex + 1, history.length);
      input.value = history[historyIndex] ?? "";
      e.preventDefault();
    }
  });

  document.getElementById("term-clear").addEventListener("click", () => {
    output.textContent = "";
    input.focus();
  });

  function restart() {
    if (port) {
      port.postMessage({ type: "kill" });
      port.disconnect();
      port = null;
    }
    append("\n[Starting new session...]\n", "sys");
    connect();
  }

  document.getElementById("term-restart").addEventListener("click", () => {
    restart();
    input.focus();
  });

  // Remember scroll position when leaving the tab; restore it when coming back.
  output.addEventListener("scroll", () => {
    if (isVisible()) stickToBottom = output.scrollHeight - output.scrollTop - output.clientHeight < 40;
  });

  document.addEventListener("pane:shown", (e) => {
    if (e.detail.pane !== "terminal") return;
    if (stickToBottom) output.scrollTop = output.scrollHeight;
    if (e.detail.focus) input.focus();
  });

  // Used by bridge.js to run commands that arrive from the chat.
  window.cmdTerminal = {
    isConnected: () => port !== null,
    run(cmd, who) {
      if (!port) return false;
      append(`[chat] ${who}: ${cmd}\n`, "from-chat");
      port.postMessage({ type: "input", data: cmd + "\r\n" });
      return true;
    },
    restart(who) {
      append(`\n[chat] ${who} restarted the session`, "from-chat");
      restart();
    },
    onOutput: (f) => outputListeners.add(f),
    onLocalInput: (f) => localInputListeners.add(f),
  };

  connect();
})();
