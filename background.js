// Background script for managing media controls across tabs
const browser = window.browser || window.chrome;

class MediaControlsManager {
  constructor() {
    this.mediaSessions = new Map(); // Key: tabId, Value: array of sessions
    this.lucidModeEnabled = false;
    this.init();
  }

  init() {
    // Listen for messages from content scripts
    browser.runtime.onMessage.addListener((message, sender) => {
      return this.handleMessage(message, sender);
    });

    // Listen for tab updates
    browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      if (changeInfo.status === "loading") {
        this.removeAllSessionsForTab(tabId);
      }
    });

    // Listen for tab removal
    browser.tabs.onRemoved.addListener((tabId) => {
      this.removeAllSessionsForTab(tabId);
    });

    // Listen for tab activation
    browser.tabs.onActivated.addListener((activeInfo) => {
      this.updateActiveTab(activeInfo.tabId);
    });

    // Load settings
    this.loadSettings();
  }

  async handleMessage(message, sender) {
    const { type, action, data } = message;

    if (type !== "MEDIA_CONTROL") return;

    switch (action) {
      case "MEDIA_DETECTED":
        await this.handleMediaDetected(data, sender);
        break;
      case "MEDIA_UPDATED":
        await this.handleMediaUpdated(data, sender);
        break;
      case "MEDIA_ENDED":
        this.removeMediaSession(sender.tab.id, sender.frameId);
        break;
      case "GET_MEDIA_TABS":
        return this.getAllSessions();
      case "CONTROL_MEDIA":
        await this.controlMedia(data);
        break;
      case "TOGGLE_LUCID_MODE":
        await this.toggleLucidMode();
        break;
      case "GET_SETTINGS":
        return { lucidModeEnabled: this.lucidModeEnabled };
    }
  }

  async handleMediaDetected(data, sender) {
    const tabId = sender.tab.id;
    const frameId = sender.frameId;

    // Create tab entry if doesn't exist
    if (!this.mediaSessions.has(tabId)) {
      this.mediaSessions.set(tabId, []);
    }

    const sessionInfo = {
      tabId,
      frameId,
      url: sender.tab.url,
      title: sender.tab.title,
      favIconUrl: sender.tab.favIconUrl,
      active: sender.tab.active,
      ...data,
    };

    const sessions = this.mediaSessions.get(tabId);
    const existingIndex = sessions.findIndex(s => s.frameId === frameId);

    if (existingIndex >= 0) {
      // Update existing session
      sessions[existingIndex] = sessionInfo;
    } else {
      // Add new session
      sessions.push(sessionInfo);
    }

    await this.updateBadge();
    this.notifyPopup();
  }

  async handleMediaUpdated(data, sender) {
    const tabId = sender.tab.id;
    const frameId = sender.frameId;

    if (!this.mediaSessions.has(tabId)) return;

    const sessions = this.mediaSessions.get(tabId);
    const sessionIndex = sessions.findIndex(s => s.frameId === frameId);

    if (sessionIndex >= 0) {
      Object.assign(sessions[sessionIndex], data);
      this.notifyPopup();
    }
  }

  removeMediaSession(tabId, frameId) {
    if (!this.mediaSessions.has(tabId)) return false;

    const sessions = this.mediaSessions.get(tabId);
    const newSessions = sessions.filter(s => s.frameId !== frameId);

    if (newSessions.length === 0) {
      this.mediaSessions.delete(tabId);
    } else {
      this.mediaSessions.set(tabId, newSessions);
    }

    this.updateBadge();
    this.notifyPopup();
    return true;
  }

  removeAllSessionsForTab(tabId) {
    if (this.mediaSessions.delete(tabId)) {
      this.updateBadge();
      this.notifyPopup();
      return true;
    }
    return false;
  }

  updateActiveTab(activeTabId) {
    for (const [tabId, sessions] of this.mediaSessions) {
      sessions.forEach(session => {
        session.active = (tabId === activeTabId);
      });
    }
    this.notifyPopup();
  }

  getAllSessions() {
    const allSessions = [];
    for (const sessions of this.mediaSessions.values()) {
      allSessions.push(...sessions);
    }
    return allSessions;
  }

  async controlMedia({ tabId, frameId, action, value }) {
    try {
      await browser.tabs.sendMessage(
        tabId,
        {
          type: "MEDIA_CONTROL",
          action: "EXECUTE_CONTROL",
          data: { action, value },
        },
        { frameId }
      );
    } catch (error) {
      console.error("Failed to control media:", error);
      // Remove session if tab is gone
      if (error.message.includes("Receiving end does not exist")) {
        this.removeMediaSession(tabId, frameId);
      }
    }
  }

  async toggleLucidMode() {
    this.lucidModeEnabled = !this.lucidModeEnabled;
    await browser.storage.local.set({ lucidModeEnabled: this.lucidModeEnabled });

    // Apply to all tabs
    const tabs = await browser.tabs.query({});
    for (const tab of tabs) {
      try {
        await browser.tabs.sendMessage(tab.id, {
          type: "MEDIA_CONTROL",
          action: "TOGGLE_LUCID_MODE",
          data: { enabled: this.lucidModeEnabled },
        });
      } catch (error) {
        // Tab might not have content script loaded
      }
    }
  }

  async updateBadge() {
    const count = this.getAllSessions().length;
    await browser.browserAction.setBadgeText({
      text: count > 0 ? count.toString() : "",
    });
    await browser.browserAction.setBadgeBackgroundColor({ color: "#4285f4" });
  }

  notifyPopup() {
    // Send update to popup if it's open
    browser.runtime
      .sendMessage({
        type: "MEDIA_TABS_UPDATED",
        data: this.getAllSessions(),
      })
      .catch(() => {
        // Popup might not be open
      });
  }

  async loadSettings() {
    const result = await browser.storage.local.get({ lucidModeEnabled: false });
    this.lucidModeEnabled = result.lucidModeEnabled;
  }
}

// Initialize the manager
new MediaControlsManager();