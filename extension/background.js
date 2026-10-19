// Clicking the toolbar button opens the CMD Bridge page (Terminal + Chat tabs) in a new tab.
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL("app.html") });
});
