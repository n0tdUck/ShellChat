# CMD Bridge for Microsoft Edge

An Edge extension that opens a tab with two features, switched with the tab bar at the top:

- **Terminal**: type commands into cmd.exe and see the output, using native messaging.
- **Chat**: real-time WebSocket chat rooms. People in the room can also run cmd.exe commands with `/cmd` and see the output in the chat (on by default, see [Running commands from the chat](#running-commands-from-the-chat)).

```
Terminal tab  <-- connectNative -->  cmd_host.py  <-- pipes -->  cmd.exe
      ^
      |  /cmd messages in, 💻 output back out (bridge.js)
      v
Chat tab      <-- WebSocket ------>  chat server (Node.js)
```

Switching tabs only hides the other feature, so the cmd.exe session and the chat connection both keep running in the background.

**Chat features:** multiple rooms, user list, typing indicator, last 50 messages of history for people who join late,
auto-reconnect with backoff, clickable links, light/dark theme, optional shared access key, rate limiting,
heartbeat to drop dead connections.

### Folders

```
cmd-bridge/
├── extension/                 # Load this folder in Edge (Manifest V3)
│   ├── manifest.json
│   ├── background.js          # toolbar button opens app.html in a new tab
│   ├── app.html / app.css     # the page and its tab bar
│   ├── tabs.js                # tab switching, unread badge, Alt+1 / Alt+2
│   ├── terminal.js / .css     # Terminal tab (native messaging client)
│   ├── chat.js / .css         # Chat tab (WebSocket client)
│   ├── bridge.js              # /cmd: connects the chat to the terminal
│   ├── terminal.html          # old entry point, redirects to app.html
│   └── icons/
├── host/                      # Native messaging host (Python)
│   ├── cmd_host.py / cmd_host.bat
│   ├── com.example.cmd_bridge.json
│   └── install.bat / uninstall.bat
├── server/                    # Chat server: Node.js WebSocket server (uses the `ws` package)
│   ├── package.json / package-lock.json
│   └── server.js
├── render.yaml                # one-click deploy of server/ to Render
└── .gitignore
```

---

## Requirements

- Windows with Microsoft Edge
- Python 3 on PATH, for the Terminal (from python.org, with "Add python.exe to PATH" ticked)
- Node.js 18 or newer, only if you run the chat server yourself (`winget install OpenJS.NodeJS.LTS`)

---

## 1. Setup

### Extension and native host

1. Put the `cmd-bridge` folder somewhere permanent. Don't move it after step 2. (If you do, run `install.bat` again.)
2. Double-click `host\install.bat`. This registers the native host for your Windows user.
3. Open `edge://extensions`, turn on **Developer mode**, click **Load unpacked**, and pick the `extension` folder.
4. Check the extension ID is `dhjefkhidmehfbbnbbpgbkakbhfjpiel`. It's fixed by the `key` in `manifest.json` and already matches `allowed_origins` in the host manifest.
5. Fully restart Edge (see Troubleshooting if it keeps running in the background), then click the CMD Bridge toolbar button.

> After you change the extension's code, click **Reload** on its card in `edge://extensions`, then close and reopen the CMD Bridge tab.
> To debug the page, right-click inside it and choose **Inspect**.

### Chat server (quick start, on your own PC)

```powershell
cd cmd-bridge\server
npm install
npm start
```

You should see `Chat server listening on ws://localhost:8080`.
Check it in a browser: <http://localhost:8080/health> should print `ok`.

Then open the **Chat** tab, enter the server URL `ws://localhost:8080`, a nickname and a room, and click **Join room**.
To let people on other computers join, see [Hosting the chat server](#3-hosting-the-chat-server).

To test with two people on one PC, open a second Edge profile, load the extension there too, and join the same room with another nickname.

---

## 2. Using it

- Click **Terminal** / **Chat** in the tab bar, press **Alt+1** / **Alt+2**, or focus the tab bar and use the Left/Right arrow keys. The page remembers the last tab you used.
- While Chat is in the background, its tab shows a count of new messages (also in the browser tab title). While Terminal is in the background, a dot means new output arrived.

### Terminal

- Type a command and press Enter. Up/Down cycles through history.
- **Restart** ends the session (including anything still running in it) and starts a fresh one.
- Ctrl+C can't be passed through pipes, so use Restart to stop a long-running command.
- Interactive full-screen programs (`edit`, `more` paging, password prompts) won't behave as in a real console.

### Chat

- Enter the server URL (e.g. `ws://localhost:8080` or `wss://your-server`), a nickname, a room, and the access key if the server has one. Your settings are saved.
- Enter sends, Shift+Enter adds a new line. The people button shows who is in the room; the arrow button leaves it.
- If your nickname is taken, you get a suffix like `Duc (2)`.

### Running commands from the chat

This is **on by default**: as soon as you join a room, the chat header shows **Commands ON** (click it to switch off for that visit). A red banner (and a *Chat control ON* label in the Terminal tab) shows while it's on. Then anyone in the room, including you, can send:

| Message | What happens |
| --- | --- |
| `/cmd dir` | Runs `dir` in the Terminal tab's cmd.exe session. Several lines run as several commands. |
| `/cmd-restart` | Restarts cmd.exe. Use it to stop something like `ping -t`, since Ctrl+C can't be sent. |

- Output is posted back to the room as messages starting with 💻, shown in a monospace bubble. It's sent in pieces of up to 1,900 characters, spaced about 1.3 s apart to stay under the server's limit of 10 messages per 10 s. After 12 pieces it's cut off with a note.
- Each command shows up in the Terminal tab in yellow, as `[chat] Name: command`.
- It's one shared cmd.exe session: `cd`, environment variables and running programs carry over between chat commands and anything typed in the Terminal tab.
- Commands you type in the Terminal tab yourself stay private: typing one stops the forwarding of output to the room until the next `/cmd`.
- Only messages that arrive while the switch is on run. Old `/cmd` messages that the server replays when you join or reconnect never run.
- The switch turns on every time you join a room and off when you leave. To make it off by default again, set `ON_BY_DEFAULT = false` in `extension\bridge.js`.
- If the server is not on this PC and you joined without an access key, it stays off and the chat explains why.

Read [Security](#6-security) before using this on a server other people can reach.

---

## 3. Hosting the chat server

### Configuration

The server reads environment variables:

| Variable     | Default         | Meaning |
|--------------|-----------------|---------|
| `PORT`       | `8080`          | TCP port to listen on |
| `HOST`       | all interfaces  | Set `127.0.0.1` when the server sits behind a reverse proxy, so the raw port isn't reachable from outside |
| `CHAT_TOKEN` | *(empty)*       | Shared access key. If set, clients must enter it in the **Access key** field. **Required for chat commands** on any server that isn't on this PC |

PowerShell example:

```powershell
$env:PORT = "9000"; $env:CHAT_TOKEN = "my-long-random-key"; npm start
```

Generate a good random key:

```powershell
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
```

### Choosing how to host it

Pick the option that matches who needs to connect.

| Who chats | Option | Cost | URL people enter |
|---|---|---|---|
| Just you (testing) | **A. Local** | free | `ws://localhost:8080` |
| People on the same Wi-Fi/office network | **B. LAN** | free | `ws://192.168.x.x:8080` |
| Friends over the internet, while your PC is on | **C. Cloudflare quick tunnel** | free | `wss://<random>.trycloudflare.com` |
| Anyone, your PC can be off | **D. Render free tier** ⭐ | free, no card | `wss://<name>.onrender.com` |
| Long-term, always on | **E. VPS + HTTPS reverse proxy** | free on Oracle Cloud, otherwise ~$4–6/month | `wss://chat.yourdomain.com` |

> **Use `wss://` (TLS) whenever traffic crosses the internet.** Plain `ws://` sends messages, commands, command output and the access key unencrypted.

### A. Local

Covered by the [quick start](#chat-server-quick-start-on-your-own-pc) above.

### B. LAN (same network)

1. Start the server as in the quick start.
2. Find your PC's IP address: run `ipconfig` and look for **IPv4 Address** (e.g. `192.168.1.42`).
3. Allow the port through Windows Firewall. Run this in **PowerShell as Administrator**:

   ```powershell
   New-NetFirewallRule -DisplayName "WebSocket Chat 8080" -Direction Inbound -Protocol TCP -LocalPort 8080 -Action Allow -Profile Private
   ```

   Your Wi-Fi must be set to the **Private** network profile (Settings → Network & internet → Wi-Fi → your network).
4. Everyone enters `ws://192.168.1.42:8080` (your IP) as the server URL.

Set `CHAT_TOKEN` first if you want chat commands: from another computer's point of view this server isn't local, so commands need a key.

### C. Internet, quick: Cloudflare quick tunnel (no router setup)

This gives your local server a temporary public HTTPS address, so WSS works with no domain or certificate.

```powershell
winget install --id Cloudflare.cloudflared
# with the chat server already running in another terminal:
cloudflared tunnel --url http://localhost:8080
```

It prints a URL like `https://quiet-river-1234.trycloudflare.com`.
Everyone uses **`wss://quiet-river-1234.trycloudflare.com`** (`https` becomes `wss`).
The URL changes each time you restart the tunnel, and anyone who has it can connect, so set `CHAT_TOKEN`.
For a permanent address, create a named tunnel on your own domain (see Cloudflare's Tunnel docs).
`ngrok http 8080` works the same way.

### D. Free cloud hosting on Render (no credit card)

[Render](https://render.com)'s free web service runs the server in the cloud with HTTPS/WSS set up for you.
The `cmd-bridge` folder includes a `render.yaml` Blueprint, so deploying takes a few clicks.

**What "free" means here** (per [Render's free-tier docs](https://render.com/docs/free)):

- The service **sleeps after 15 minutes without incoming traffic** and takes **about a minute to wake up**.
  - While anyone has the Chat tab joined to a room, the extension sends a small keepalive message every 4 minutes, so the server stays awake.
  - When someone joins a sleeping server, the Chat tab shows "waking up" and keeps retrying for up to 90 seconds.
- 750 free instance hours per month. That's enough for one service running 24/7.
- Chat history is lost whenever the service sleeps, restarts, or redeploys (it's kept in memory only).

**1. Put the server project on GitHub.** Create an empty repository on github.com (private is fine), then run these commands
in the `cmd-bridge` folder (the one that contains `render.yaml`). `.gitignore` keeps `node_modules` and `host.log` out:

```powershell
git init
git add .
git commit -m "WebSocket chat"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/cmd-bridge.git
git push -u origin main
```

No Git? On the new repo's page, click **uploading an existing file** and drag in everything inside `cmd-bridge`,
including `render.yaml` (skip `server\node_modules` and `host\host.log` if you have them).

**2. Pick a region.** `render.yaml` uses `singapore`. If most of your users are elsewhere, change it to the closest of
`oregon`, `ohio`, `virginia` or `frankfurt` *before* the first deploy. The region can't be changed later.

**3. Deploy.** Sign up at [render.com](https://render.com) with your GitHub account, then go to **New → Blueprint**.
Pick your repository and click **Deploy Blueprint**. Wait until the service shows **Live** (the first build takes 1–3 minutes).

**4. Check it.** Open `https://websocket-chat-xxxx.onrender.com/health` (your service's URL is at the top of its page). It should show `ok`.

**5. Get the access key.** Render generated a random `CHAT_TOKEN` for you: open the service, go to **Environment**, and reveal/copy `CHAT_TOKEN`.
Share it only with people you want in the chat. With commands on, everyone who has it can run commands on your PC while you're in a room.

**6. Connect.** In the Chat tab, use the server URL **`wss://websocket-chat-xxxx.onrender.com`** (`wss://` and no port) and paste the access key.

**Updating:** push to `main`, and Render redeploys automatically. Connected chats drop for a moment and reconnect by themselves.

<details>
<summary>Without the Blueprint (manual setup)</summary>

**New → Web Service** → pick the repo, then set:

- **Root Directory:** `server`
- **Build Command:** `npm ci --omit=dev`
- **Start Command:** `node server.js`
- **Instance Type:** Free
- **Environment variables:** `HOST` = `0.0.0.0`, `CHAT_TOKEN` = a random key
- **Health Check Path** (under Advanced): `/health`
</details>

<details>
<summary>Other free options and why they're not the default</summary>

- **Oracle Cloud Always Free:** a real Linux VM that is always on, with no sleeping. Set it up with option E below.
  - Signing up needs a credit card for identity verification.
  - You'll want a free domain for HTTPS, for example from DuckDNS.
  - Oracle [may reclaim idle Always Free instances](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm): CPU, network (and on Arm shapes, memory) use under 20% for 7 days. A quiet chat server can meet that rule.
- **Cloudflare Tunnel from your own PC** (option C) is free but only works while your PC is on.
- **No longer free for new accounts:** Fly.io (short trial only), Railway (one-time trial credit, then $1/month of credit),
  Koyeb (needs a card and a $29 pre-authorization since Feb 2026), Heroku. Glitch stopped hosting projects in 2025.
</details>

### E. Production: Linux VPS + Caddy (automatic HTTPS)

This assumes an Ubuntu/Debian VPS and a domain such as `chat.example.com` whose DNS **A record** points at the VPS's IP.

**1. Install Node.js and copy the server**

```bash
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo mkdir -p /opt/edge-websocket-chat
# copy the server/ folder from your PC, e.g.:  scp -r server user@your-vps:/tmp/  then:
sudo cp -r /tmp/server /opt/edge-websocket-chat/
cd /opt/edge-websocket-chat/server && sudo npm ci --omit=dev
```

**2. Run it as a service (systemd)** so it starts on boot and restarts if it crashes.

```bash
sudo useradd --system --no-create-home chat
sudo nano /etc/systemd/system/chat.service
```

```ini
[Unit]
Description=WebSocket chat server
After=network.target

[Service]
User=chat
WorkingDirectory=/opt/edge-websocket-chat/server
ExecStart=/usr/bin/node server.js
Environment=PORT=8080
Environment=HOST=127.0.0.1
Environment=CHAT_TOKEN=replace-with-your-random-key
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now chat
sudo systemctl status chat        # should be "active (running)"
journalctl -u chat -f             # live logs (joins/leaves)
```

**3. Put Caddy in front for HTTPS/WSS.** Caddy gets and renews a Let's Encrypt certificate automatically and proxies WebSockets with no extra settings.

```bash
sudo apt-get install -y caddy
sudo nano /etc/caddy/Caddyfile
```

```caddyfile
chat.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

```bash
sudo systemctl reload caddy
```

**4. Open the firewall** for web traffic only (port 8080 stays private because `HOST=127.0.0.1`):

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80,443/tcp
sudo ufw enable
```

**5. Test:** <https://chat.example.com/health> prints `ok`. In the Chat tab, use **`wss://chat.example.com`**.

<details>
<summary>Using nginx instead of Caddy</summary>

WebSockets need the `Upgrade`/`Connection` headers forwarded. Get a certificate with `sudo certbot --nginx -d chat.example.com`.

```nginx
server {
    listen 443 ssl;
    server_name chat.example.com;
    # ssl_certificate / ssl_certificate_key lines are added by certbot

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 120s;   # server pings every 30s, so idle sockets stay open
    }
}
```
</details>

<details>
<summary>Keeping it running on Windows instead</summary>

Use [pm2](https://pm2.keymetrics.io/):

```powershell
npm install -g pm2
cd cmd-bridge\server
$env:CHAT_TOKEN = "your-key"; pm2 start server.js --name chat
pm2 save
```

For start-on-boot on Windows, use the `pm2-windows-startup` package or a Task Scheduler task that runs `pm2 resurrect` at logon.
For internet access, combine it with option C (Cloudflare Tunnel) rather than opening router ports.
</details>

---

## 4. Message protocols

### Chat (WebSocket)

All frames are JSON text. You can use it to write other clients (web page, mobile app, bot).

| Direction | Message | Notes |
|---|---|---|
| client → server | `{"type":"join","name":"Duc","room":"lobby","token":"…"}` | Must be the first message, within 10 s. `token` only if `CHAT_TOKEN` is set |
| client → server | `{"type":"message","text":"hello"}` | Max 2000 characters, max 10 messages per 10 s |
| client → server | `{"type":"typing"}` | Relayed to others at most once per second |
| client → server | `{"type":"ping"}` | Keepalive, sent every 4 min. No reply. Keeps free hosts from sleeping while people are connected |
| server → client | `{"type":"welcome","you":{id,name,room},"users":[…],"history":[…]}` | Your name may get a suffix like `Duc (2)` if it's taken |
| server → client | `{"type":"message","id","from":{id,name},"text","ts"}` | Also sent back to the sender |
| server → client | `{"type":"system","text":"Alice joined","ts"}` | Join/leave notices |
| server → client | `{"type":"users","users":[{id,name}…]}` | Whenever the room's user list changes |
| server → client | `{"type":"typing","from":{id,name}}` | |
| server → client | `{"type":"error","message":"…"}` | |

Close codes **4000–4099** mean "don't auto-reconnect" (4000 join timeout, 4001 wrong access key).

Chat commands are ordinary `message`s, so the server needs no changes for them: text starting with `/cmd ` or equal to `/cmd-restart` is a command, and text starting with `💻 ` is command output (CMD Bridge never runs those, which prevents loops).

Quick manual test from a terminal:

```powershell
npx wscat -c ws://localhost:8080
> {"type":"join","name":"Tester","room":"lobby"}
> {"type":"message","text":"hi from wscat"}
```

### Native host (Terminal)

Each message is UTF-8 JSON preceded by a 4-byte little-endian length (Edge's native messaging format).

| Direction | Message | Notes |
|---|---|---|
| extension → host | `{"type":"input","data":"dir\r\n"}` | Written to cmd.exe's stdin |
| extension → host | `{"type":"kill"}` | Ends the cmd.exe session and everything it started |
| host → extension | `{"type":"output","data":"…"}` | Text from cmd.exe's stdout/stderr |
| host → extension | `{"type":"error","data":"…"}` | Problem inside the host |
| host → extension | `{"type":"exit","code":0}` | cmd.exe has exited |

---

## 5. Troubleshooting

### Terminal

| Message | Cause |
| --- | --- |
| Specified native messaging host not found | `install.bat` not run from this folder, folder moved after installing, or Edge not fully restarted |
| Access to the specified native messaging host is forbidden | Extension ID doesn't match `allowed_origins` in `host\com.example.cmd_bridge.json` |
| Native host has exited | The host started but quit. Open `host\host.log` to see why (usually Python not installed, or only the Microsoft Store placeholder) |

- **Check the registration:** `reg query "HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.example.cmd_bridge" /ve` should print the full path of `host\com.example.cmd_bridge.json` in this folder.
- **No `host\host.log` at all** means Edge has never started the host from this folder: run `install.bat` here.
- **Fully restarting Edge:** closing the windows isn't always enough. End every "Microsoft Edge" process in Task Manager, or turn off **Startup boost** and **Continue running background extensions and apps** in `edge://settings/system`.
- On a work computer, check `edge://policy` for `NativeMessagingBlocklist` / `NativeMessagingUserLevelHosts`, which can block this.

### Chat

| Symptom | Fix |
|---|---|
| "Could not connect to ws://…" | Is the server running? Does `/health` load in the browser at the same host and port? |
| Works on your PC but not for others on the LAN | Use your IP, not `localhost`. Add the firewall rule. Make sure the network profile is *Private*. |
| Behind HTTPS/Cloudflare it fails with `ws://` | Use `wss://` (and no `:8080`) when the server is behind TLS. |
| "Invalid access key" | The key must match the server's `CHAT_TOKEN` exactly. |
| Render: joining takes ~1 minute | The free service was asleep. The Chat tab retries automatically, so wait for it. |
| Render: build fails at `npm ci` | Make sure `server/package-lock.json` was committed along with `package.json`. |
| Chat shows "Unknown message type: ping" | The server is an older copy. Restart or redeploy it with the current `server.js`. |
| Port already in use | Another program uses 8080. Start with `$env:PORT="9000"; npm start` and connect to `:9000`. |

### Chat commands

| Symptom | Fix |
|---|---|
| "Commands need an access key" and the switch stays off | The server isn't on this PC and you joined without a key. Start the server with `CHAT_TOKEN`, then leave and rejoin with that key. |
| `/cmd` messages do nothing | Check the header says **Commands ON**. It must start with `/cmd ` (with a space). Old messages from before you joined never run. |
| "cmd.exe isn't running" | The Terminal tab is disconnected. Send `/cmd-restart` or click **Restart**, and see the Terminal table above if it fails. |
| Output stops with "Output truncated" | The command printed more than 12 messages' worth. Narrow it down (e.g. `dir /b`, `findstr`) or run it in the Terminal tab. |
| "You are sending messages too fast" | You typed several messages while output was being posted. Output is already spaced out; wait a few seconds. |

---

## 6. Security

**The native host.** Anything that can talk to this host can run any command as you. Only this extension's ID is allowed in `allowed_origins`. Don't add content scripts or `externally_connectable` that forward messages from web pages to the host, or a website could run commands on your computer.

**The chat.** The Chat tab runs in the same page as the Terminal and receives text from other people over the network. Chat messages are only ever rendered as text (never HTML). They reach cmd.exe **only** while **Commands** is switched on, and only messages starting with `/cmd`. Commands are on by default whenever you're in a room, and while they're on, everyone in the room can do anything on this PC that you can. So:

- Use a server with an access key (`CHAT_TOKEN`), and `wss://` if it's on the internet. The switch refuses to turn on without a key unless the server is on this PC.
- Treat the access key like a password to your PC. Share it only with people you'd let sit at your keyboard, and change it (and restart the server) if it leaks.
- Use a private room name. Leave the room (or click the switch off) when you don't need commands.
- Nicknames aren't verified; anyone with the key can pick any name.
- Command output is posted to the whole room and kept in the server's 50-message history, so avoid commands that print secrets.

---

## 7. Limitations and ideas for later

- **Chat history is in memory.** It is lost when the server restarts or the last person leaves a room. Add SQLite or Redis to keep it.
- **No user accounts.** `CHAT_TOKEN` is one shared password, and nicknames are not reserved. For real identities, add login (for example OAuth) and issue per-user tokens; then chat commands could be limited to specific people.
- **Everything lives in the CMD Bridge tab.** Closing the tab ends the cmd.exe session and disconnects the chat, and there are no notifications while it's closed. Moving the socket into the background service worker (with a keepalive) plus `chrome.notifications` would add that.
- **One cmd.exe session per tab.** Each CMD Bridge tab has its own session and its own chat connection; chat commands run in the tab that received them, so keep only one tab joined if you use commands.
- **One server process.** To run several instances behind a load balancer, broadcast through Redis pub/sub.
- **Publishing:** to share the extension without Developer mode, submit it to the Edge Add-ons store through Microsoft Partner Center.

---

## Uninstall

Run `host\uninstall.bat` and remove the extension from `edge://extensions`. Stop the chat server if you run it (Ctrl+C, `pm2 delete chat`, or delete the Render service).

## Updating from 1.0

The page is now `extension\app.html` (`terminal.html` just redirects to it). Click **Reload** on the extension's card in `edge://extensions`; the extension ID doesn't change, so you don't need to re-run `install.bat`. You can remove the old *WebSocket Chat* side-panel extension from Edge. The chat server and `render.yaml` are now in this folder too, so the old `edge-websocket-chat-render` folder is no longer needed (if you deployed to Render from its GitHub repo, that deployment keeps working; push from `cmd-bridge` instead for future updates, or keep using the old repo).
