// CMD Bridge runs entirely in this background service worker; there is no page.
//
// Every time the worker starts (browser start, extension install/update/reload, or a wake-up
// alarm after the browser stopped it) it:
//   - starts a cmd.exe session through the native messaging host (terminal.js)
//   - joins the chat room from the saved settings or the defaults (chat.js)
//   - relays /cmd messages from the room to cmd.exe and posts the output back (bridge.js)
//
// The toolbar button replaces the old page's controls:
//   - click it to switch room commands ON/OFF (they switch ON every time the room is joined)
//   - if joining failed, click it to try again
// The badge shows the state ("ON" = anyone in the room can run commands on this PC), and the
// button's tooltip has the details. Logs are in the service worker's DevTools console
// (extensions page > CMD Bridge > "service worker").
import { terminal } from './terminal.js';
import { chat } from './chat.js';
import { bridge } from './bridge.js';

const KEEPALIVE_ALARM = 'cmd-bridge-keepalive';

function updateBadge() {
  const status = chat.status();
  const on = bridge.isEnabled();
  const room = `#${chat.room()}`;
  const me = chat.me()?.name;
  const cmdLine = terminal.isConnected()
    ? ''
    : '\ncmd.exe is not running. Send /cmd-restart in the room to start it.';

  let text = '';
  let color = '#6b6b76';
  let title;
  if (status === 'online') {
    const where = `${room} as ${me} (${chat.userCount()} here)`;
    if (on) {
      text = 'ON';
      color = '#c50f1f';
      title = `CMD Bridge: in ${where}.\nCommands are ON: anyone in ${room} can run cmd.exe commands on this PC with /cmd.\nClick to turn them off.`;
    } else {
      title = `CMD Bridge: in ${where}.\nCommands are off. Click to turn them on.`;
    }
  } else if (status === 'connecting' || status === 'reconnecting') {
    text = '…';
    title = `CMD Bridge: ${status === 'connecting' ? 'joining' : 'reconnecting to'} ${room}…`;
  } else if (status === 'error') {
    text = '!';
    color = '#d68b00';
    title = `CMD Bridge: could not join ${room}: ${chat.error()}\nClick to try again.`;
  } else {
    title = 'CMD Bridge: not in a room. Click to join.';
  }

  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
  chrome.action.setTitle({ title: title + cmdLine });
}

chat.onStatus(updateBadge);
bridge.onChange(updateBadge);
terminal.onStatus(updateBadge);

chrome.action.onClicked.addListener(() => {
  const status = chat.status();
  if (status === 'error' || status === 'stopped') chat.start();
  else if (status === 'online') bridge.setEnabled(!bridge.isEnabled());
  // still connecting: nothing to switch yet
});

// These listeners make the browser start the worker on browser startup and on install/update.
// The work itself happens below, which runs on every worker start.
chrome.runtime.onStartup.addListener(() => {});
chrome.runtime.onInstalled.addListener(() => {});

// Backstop: if the browser ever stops the worker (e.g. cmd.exe exited and the server went
// quiet), this alarm starts it again, which reconnects everything.
chrome.alarms.get(KEEPALIVE_ALARM).then((alarm) => {
  if (!alarm) chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.5 });
});
chrome.alarms.onAlarm.addListener(() => {});

updateBadge();
terminal.start();
chat.start().catch((e) => console.error('CMD Bridge: could not start the chat:', e));
