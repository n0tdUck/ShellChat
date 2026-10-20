'use strict';

// Tab switcher for the Terminal and Chat panes.
// Panes are only hidden, never torn down, so the cmd.exe session and the chat
// connection both keep running while you look at the other tab.
//
// Exposes two small globals the feature scripts use:
//   isPaneActive(name)  -> true if that pane is the visible one
//   notifyPane(name)    -> mark background activity (unread badge / dot) on a hidden tab
// and fires a "pane:shown" event on document whenever a pane becomes visible.

(() => {
  const STORAGE_KEY = 'cmdBridge.activePane';
  const BASE_TITLE = document.title;
  const tabs = [...document.querySelectorAll('.tabbar [role="tab"]')];
  const names = tabs.map((t) => t.dataset.pane);
  const unread = Object.fromEntries(names.map((n) => [n, 0]));
  let active = null;

  const tabFor = (name) => tabs.find((t) => t.dataset.pane === name);

  function activate(name, { focus = true } = {}) {
    if (!names.includes(name)) name = names[0];
    active = name;
    for (const tab of tabs) {
      const on = tab.dataset.pane === name;
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
      document.getElementById(tab.getAttribute('aria-controls')).hidden = !on;
    }
    unread[name] = 0;
    renderIndicators();
    try { localStorage.setItem(STORAGE_KEY, name); } catch { /* storage unavailable: just don't remember */ }
    document.dispatchEvent(new CustomEvent('pane:shown', { detail: { pane: name, focus } }));
  }

  function renderIndicators() {
    for (const name of names) {
      const tab = tabFor(name);
      const badge = tab.querySelector('.tab-badge');
      const dot = tab.querySelector('.tab-dot');
      if (badge) {
        badge.hidden = unread[name] === 0;
        badge.textContent = unread[name] > 99 ? '99+' : String(unread[name]);
      }
      if (dot) dot.hidden = unread[name] === 0;
    }
    const chatUnread = unread.chat || 0;
    document.title = chatUnread ? `(${chatUnread}) ${BASE_TITLE}` : BASE_TITLE;
  }

  window.isPaneActive = (name) => active === name;

  window.notifyPane = (name) => {
    if (active === name || !(name in unread)) return;
    unread[name]++;
    renderIndicators();
  };

  // Mouse
  for (const tab of tabs) {
    tab.addEventListener('click', () => activate(tab.dataset.pane));
  }

  // Keyboard inside the tab bar: Left/Right/Home/End (standard tablist behaviour)
  document.querySelector('.tabbar').addEventListener('keydown', (e) => {
    const i = tabs.indexOf(document.activeElement);
    if (i < 0) return;
    let next = null;
    if (e.key === 'ArrowRight') next = (i + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    if (next === null) return;
    e.preventDefault();
    activate(tabs[next].dataset.pane, { focus: false });
    tabs[next].focus();
  });

  // Anywhere on the page: Alt+1, Alt+2, ... jump straight to a tab
  document.addEventListener('keydown', (e) => {
    if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const n = Number(e.key);
    if (Number.isInteger(n) && n >= 1 && n <= tabs.length) {
      e.preventDefault();
      activate(tabs[n - 1].dataset.pane);
    }
  });

  // Show the remembered pane right away (no flash), but announce it only after
  // the feature scripts below have loaded and registered their listeners.
  let initial = names[0];
  try { initial = localStorage.getItem(STORAGE_KEY) || initial; } catch { /* ignore */ }
  for (const tab of tabs) {
    document.getElementById(tab.getAttribute('aria-controls')).hidden = tab.dataset.pane !== initial;
  }
  active = names.includes(initial) ? initial : names[0];
  document.addEventListener('DOMContentLoaded', () => activate(active));
})();
