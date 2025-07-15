// Firefox-compatible popup script - FIXED VERSION
const browser = window.browser || window.chrome;

class MediaControlsPopup {
  constructor() {
    this.mediaTabs = [];
    this.lucidModeEnabled = false;
    this.controlHandlers = new Map(); // Track handlers to prevent duplicates
    this.isInitialized = false;
    this.init();
  }

  async init() {
    if (this.isInitialized) return;
    
    console.log("MediaControlsPopup: Initializing...");
    this.updateDebug("Initializing popup...");
    
    try {
      // Setup event listeners first
      this.setupEventListeners();
      
      // Load data with timeout
      const loadPromise = Promise.race([
        this.loadData(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Load timeout")), 5000))
      ]);
      
      await loadPromise;
      
      // Initial render
      this.render();
      
      this.isInitialized = true;
      console.log("MediaControlsPopup: Initialized successfully");
      this.updateDebug("Popup initialized successfully");
      
    } catch (error) {
      console.error("MediaControlsPopup: Initialization failed:", error);
      this.updateDebug(`Init failed: ${error.message}`);
      this.renderError("Failed to initialize popup");
    }
  }

  async loadData() {
    console.log("Loading popup data...");
    
    // Load both in parallel
    const [mediaTabs, settings] = await Promise.all([
      this.loadMediaTabs(),
      this.loadSettings()
    ]);
    
    console.log("Data loaded:", { mediaTabs: mediaTabs.length, settings });
    return { mediaTabs, settings };
  }

  async loadMediaTabs() {
    try {
      console.log("Loading media tabs...");
      const response = await this.sendMessage({
        type: "MEDIA_CONTROL",
        action: "GET_MEDIA_TABS",
      });
      
      this.mediaTabs = Array.isArray(response) ? response : [];
      console.log("Loaded media tabs:", this.mediaTabs.length);
      this.updateDebug(`Found ${this.mediaTabs.length} media tabs`);
      return this.mediaTabs;
      
    } catch (error) {
      console.error("Failed to load media tabs:", error);
      this.updateDebug(`Failed to load media: ${error.message}`);
      this.mediaTabs = [];
      return [];
    }
  }

  async loadSettings() {
    try {
      console.log("Loading settings...");
      const settings = await this.sendMessage({
        type: "MEDIA_CONTROL",
        action: "GET_SETTINGS",
      });
      
      this.lucidModeEnabled = settings?.lucidModeEnabled || false;
      this.updateLucidModeButton(this.lucidModeEnabled);
      console.log("Loaded settings:", settings);
      return settings;
      
    } catch (error) {
      console.error("Failed to load settings:", error);
      this.updateDebug(`Failed to load settings: ${error.message}`);
      this.lucidModeEnabled = false;
      this.updateLucidModeButton(false);
      return null;
    }
  }

  async sendMessage(message) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Message timeout"));
      }, 3000);
      
      browser.runtime.sendMessage(message)
        .then(response => {
          clearTimeout(timeout);
          resolve(response);
        })
        .catch(error => {
          clearTimeout(timeout);
          reject(error);
        });
    });
  }

  setupEventListeners() {
    console.log("Setting up event listeners...");
    
    // Toolbar buttons
    const pauseAllBtn = document.getElementById("pauseAll");
    const muteAllBtn = document.getElementById("muteAll");
    const lucidModeBtn = document.getElementById("lucidMode");
    
    if (pauseAllBtn) {
      pauseAllBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        console.log("Pause all clicked");
        this.pauseAll();
      });
    }

    if (muteAllBtn) {
      muteAllBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        console.log("Mute all clicked");
        this.muteAll();
      });
    }

    if (lucidModeBtn) {
      lucidModeBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        console.log("Lucid mode clicked");
        this.toggleLucidMode();
      });
    }

    // Listen for updates from background script
    if (browser.runtime && browser.runtime.onMessage) {
      browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
        console.log("Popup received message:", message);
        
        if (message.type === "MEDIA_TABS_UPDATED") {
          this.mediaTabs = Array.isArray(message.data) ? message.data : [];
          this.updateDebug(`Updated: ${this.mediaTabs.length} media tabs`);
          this.render();
        }
        
        return false; // Synchronous response
      });
    }

    // Double-click to toggle debug
    document.addEventListener("dblclick", (e) => {
      if (e.target.closest(".toolbar")) {
        document.body.classList.toggle("show-debug");
      }
    });
  }

  render() {
    console.log("Rendering popup with", this.mediaTabs.length, "media tabs");
    
    const mediaList = document.getElementById("mediaList");
    if (!mediaList) {
      console.error("Media list element not found!");
      return;
    }

    if (this.mediaTabs.length === 0) {
      mediaList.innerHTML = '<div class="no-media">No active media found</div>';
      return;
    }

    // Clear existing handlers
    this.controlHandlers.clear();

    // Group tabs by tabId to handle multiple frames
    const groupedTabs = new Map();
    this.mediaTabs.forEach(tab => {
      if (!groupedTabs.has(tab.tabId)) {
        groupedTabs.set(tab.tabId, []);
      }
      groupedTabs.get(tab.tabId).push(tab);
    });

    // Render each tab group
    const htmlParts = [];
    for (const [tabId, tabs] of groupedTabs) {
      // Use the first tab for main info, or find the active one
      const mainTab = tabs.find(t => !t.paused) || tabs[0];
      htmlParts.push(this.renderMediaItem(mainTab));
    }
    
    mediaList.innerHTML = htmlParts.join("");

    // Add event listeners to controls after rendering
    this.setupMediaItemControls();
  }

  renderMediaItem(tab) {
    const progress = (tab.duration && tab.duration > 0) ? (tab.currentTime / tab.duration) * 100 : 0;
    const currentTimeStr = this.formatTime(tab.currentTime || 0);
    const durationStr = this.formatTime(tab.duration || 0);
    
    // Create unique identifier for this media item
    const itemId = `${tab.tabId}-${tab.frameId || 0}`;
    
    // Determine if media is playing
    const isPlaying = !tab.paused;
    const isMuted = tab.muted || tab.volume === 0;

    return `
      <div class="media-item ${tab.active ? "active" : ""}" data-tab-id="${tab.tabId}" data-frame-id="${tab.frameId || 0}" data-item-id="${itemId}">
        <div class="media-artwork">
          ${tab.artwork ? `<img src="${tab.artwork}" alt="" onerror="this.style.display='none'">` : ""}
        </div>
        <div class="media-info">
          <div class="media-title">${this.escapeHtml(tab.title || "Unknown")}</div>
          <div class="media-artist">${this.escapeHtml(tab.artist || this.getHostname(tab.url))}</div>
          <div class="media-controls">
            <button class="control-btn primary" data-action="toggle" data-item-id="${itemId}">
              <svg viewBox="0 0 24 24">
                ${
                  isPlaying
                    ? '<path d="M14,19H18V5H14M6,19H10V5H6V19Z"/>'
                    : '<path d="M8,5.14V19.14L19,12.14L8,5.14Z"/>'
                }
              </svg>
            </button>
            <div class="volume-control">
              <button class="control-btn" data-action="mute" data-item-id="${itemId}">
                <svg viewBox="0 0 24 24">
                  ${
                    isMuted
                      ? '<path d="M12,4L9.91,6.09L12,8.18M4.27,3L3,4.27L7.73,9H3V15H7L12,20V13.27L16.25,17.53C15.58,18.04 14.83,18.46 14,18.7V20.77C15.38,20.45 16.63,19.82 17.68,18.96L19.73,21L21,19.73L12,10.73M19,12C19,12.94 18.8,13.82 18.46,14.64L19.97,16.15C20.62,14.91 21,13.5 21,12C21,7.72 18,4.14 14,3.23V5.29C16.89,6.15 19,8.83 19,12M16.5,12C16.5,10.23 15.5,8.71 14,7.97V10.18L16.45,12.63C16.5,12.43 16.5,12.21 16.5,12Z"/>'
                      : '<path d="M14,3.23V5.29C16.89,6.15 19,8.83 19,12C19,15.17 16.89,17.84 14,18.7V20.77C18,19.86 21,16.28 21,12C21,7.72 18,4.14 14,3.23M16.5,12C16.5,10.23 15.5,8.71 14,7.97V16C15.5,15.29 16.5,13.76 16.5,12M3,9V15H7L12,20V4L7,9H3Z"/>'
                  }
                </svg>
              </button>
              <input type="range" class="volume-slider" min="0" max="1" step="0.01" 
                     value="${isMuted ? 0 : (tab.volume || 1)}" 
                     data-action="volume" data-item-id="${itemId}">
            </div>
            ${
              tab.isVideo
                ? `
              <button class="control-btn" data-action="picture-in-picture" data-item-id="${itemId}">
                <svg viewBox="0 0 24 24">
                  <path d="M19,11H11V17H19V11M21,3H3A2,2 0 0,0 1,5V19A2,2 0 0,0 3,21H21A2,2 0 0,0 23,19V5C23,3.88 22.1,3 21,3M21,19H3V4.97H21V19Z"/>
                </svg>
              </button>
            `
                : ""
            }
            <button class="control-btn" data-action="focus-tab" data-item-id="${itemId}">
              <svg viewBox="0 0 24 24">
                <path d="M21,3H3A2,2 0 0,0 1,5V19A2,2 0 0,0 3,21H21A2,2 0 0,0 23,19V5A2,2 0 0,0 21,3M21,19H3V5H13V9H21V19Z"/>
              </svg>
            </button>
          </div>
          <div class="time-info">${currentTimeStr} / ${durationStr}</div>
        </div>
        <div class="progress-bar" style="width: ${progress}%"></div>
      </div>
    `;
  }

  setupMediaItemControls() {
    console.log("Setting up media item controls...");
    
    const controls = document.querySelectorAll("[data-action]");
    console.log("Found", controls.length, "controls");
    
    controls.forEach((control) => {
      const action = control.dataset.action;
      const itemId = control.dataset.itemId;
      
      if (!itemId) {
        console.warn("Control missing item ID:", control);
        return;
      }
      
      const [tabId, frameId] = itemId.split('-');
      const tabIdInt = parseInt(tabId);
      const frameIdInt = parseInt(frameId);
      
      // Create unique key for this control
      const controlKey = `${itemId}-${action}`;
      
      // Remove existing handler if exists
      if (this.controlHandlers.has(controlKey)) {
        const oldHandler = this.controlHandlers.get(controlKey);
        control.removeEventListener("click", oldHandler.click);
        control.removeEventListener("input", oldHandler.input);
        control.removeEventListener("change", oldHandler.change);
      }

      // Create new handlers
      const handlers = {};
      
      if (action === "volume") {
        handlers.input = (e) => {
          e.preventDefault();
          e.stopPropagation();
          const value = parseFloat(e.target.value);
          console.log("Volume change:", value, "for tab", tabIdInt);
          this.updateDebug(`Volume: ${(value * 100).toFixed(0)}%`);
          this.controlMedia(tabIdInt, frameIdInt, "volume", value);
        };
        
        handlers.change = handlers.input; // Also listen for change events
        
        control.addEventListener("input", handlers.input);
        control.addEventListener("change", handlers.change);
      } else if (action === "focus-tab") {
        handlers.click = (e) => {
          e.preventDefault();
          e.stopPropagation();
          console.log("Focus tab:", tabIdInt);
          this.updateDebug(`Focusing tab ${tabIdInt}`);
          this.focusTab(tabIdInt);
        };
        control.addEventListener("click", handlers.click);
      } else {
        handlers.click = (e) => {
          e.preventDefault();
          e.stopPropagation();
          console.log("Control action:", action, "for tab", tabIdInt);
          this.updateDebug(`Action: ${action}`);
          this.controlMedia(tabIdInt, frameIdInt, action);
        };
        control.addEventListener("click", handlers.click);
      }
      
      // Store handlers for cleanup
      this.controlHandlers.set(controlKey, handlers);
    });
  }

  async controlMedia(tabId, frameId, action, value) {
    try {
      console.log("Controlling media:", { tabId, frameId, action, value });
      this.updateDebug(`Sending ${action} command...`);
      
      const message = {
        type: "MEDIA_CONTROL",
        action: "CONTROL_MEDIA",
        data: { tabId, frameId, action, value },
      };
      
      await this.sendMessage(message);
      console.log("Control message sent successfully");
      this.updateDebug(`${action} command sent`);
      
      // Update UI immediately for better responsiveness
      this.updateMediaState(tabId, frameId, action, value);
      
    } catch (error) {
      console.error("Failed to control media:", error);
      this.updateDebug(`Control failed: ${error.message}`);
    }
  }

  updateMediaState(tabId, frameId, action, value) {
    // Find and update the media tab state for immediate UI feedback
    const mediaTab = this.mediaTabs.find(tab => 
      tab.tabId === tabId && (tab.frameId === frameId || frameId === 0)
    );
    
    if (mediaTab) {
      switch (action) {
        case "play":
          mediaTab.paused = false;
          break;
        case "pause":
          mediaTab.paused = true;
          break;
        case "toggle":
          mediaTab.paused = !mediaTab.paused;
          break;
        case "volume":
          mediaTab.volume = value;
          if (value > 0) mediaTab.muted = false;
          break;
        case "mute":
          mediaTab.muted = !mediaTab.muted;
          break;
      }
      
      // Re-render to show immediate feedback
      this.render();
    }
  }

  async focusTab(tabId) {
    try {
      console.log("Focusing tab:", tabId);
      this.updateDebug(`Focusing tab ${tabId}`);
      
      await browser.tabs.update(tabId, { active: true });
      
      // Get the current window and focus it
      const currentWindow = await browser.windows.getCurrent();
      await browser.windows.update(currentWindow.id, { focused: true });
      
      // Close popup after focusing tab
      setTimeout(() => {
        window.close();
      }, 200);
      
    } catch (error) {
      console.error("Failed to focus tab:", error);
      this.updateDebug(`Focus failed: ${error.message}`);
    }
  }

  async pauseAll() {
    console.log("Pausing all media...");
    this.updateDebug("Pausing all media...");
    
    const activeTabs = this.mediaTabs.filter(tab => !tab.paused);
    console.log("Found", activeTabs.length, "active tabs to pause");
    
    if (activeTabs.length === 0) {
      this.updateDebug("No active media to pause");
      return;
    }
    
    const pausePromises = activeTabs.map(tab => 
      this.controlMedia(tab.tabId, tab.frameId, "pause")
    );
    
    try {
      await Promise.all(pausePromises);
      console.log("All media paused");
      this.updateDebug(`Paused ${activeTabs.length} media items`);
    } catch (error) {
      console.error("Failed to pause all media:", error);
      this.updateDebug(`Pause failed: ${error.message}`);
    }
  }

  async muteAll() {
    console.log("Muting/unmuting all media...");
    this.updateDebug("Toggling mute for all media...");
    
    const hasUnmuted = this.mediaTabs.some((tab) => !tab.muted && tab.volume > 0);
    console.log("Has unmuted media:", hasUnmuted);
    
    const mutePromises = this.mediaTabs.map(tab => {
      if (hasUnmuted) {
        // Mute all unmuted media
        if (!tab.muted && tab.volume > 0) {
          return this.controlMedia(tab.tabId, tab.frameId, "mute");
        }
      } else {
        // Unmute all muted media
        if (tab.muted || tab.volume === 0) {
          return this.controlMedia(tab.tabId, tab.frameId, "mute");
        }
      }
      return Promise.resolve();
    });

    try {
      await Promise.all(mutePromises);
      console.log("All media mute toggled");
      this.updateDebug(hasUnmuted ? "Muted all media" : "Unmuted all media");
    } catch (error) {
      console.error("Failed to mute all media:", error);
      this.updateDebug(`Mute failed: ${error.message}`);
    }
  }

  async toggleLucidMode() {
    console.log("Toggling lucid mode...");
    this.updateDebug("Toggling lucid mode...");
    
    try {
      await this.sendMessage({
        type: "MEDIA_CONTROL",
        action: "TOGGLE_LUCID_MODE",
      });
      
      // Toggle local state
      this.lucidModeEnabled = !this.lucidModeEnabled;
      this.updateLucidModeButton(this.lucidModeEnabled);
      
      console.log("Lucid mode toggled:", this.lucidModeEnabled);
      this.updateDebug(`Lucid mode: ${this.lucidModeEnabled ? "ON" : "OFF"}`);
      
    } catch (error) {
      console.error("Failed to toggle lucid mode:", error);
      this.updateDebug(`Lucid mode failed: ${error.message}`);
    }
  }

  updateLucidModeButton(enabled) {
    const button = document.getElementById("lucidMode");
    if (button) {
      if (enabled) {
        button.classList.add("active");
      } else {
        button.classList.remove("active");
      }
    }
  }

  renderError(message) {
    const mediaList = document.getElementById("mediaList");
    if (mediaList) {
      mediaList.innerHTML = `<div class="no-media">Error: ${message}</div>`;
    }
  }

  updateDebug(message) {
    const debugElement = document.getElementById("debugText");
    if (debugElement) {
      debugElement.textContent = message;
    }
  }

  formatTime(seconds) {
    if (!seconds || !isFinite(seconds) || seconds < 0) return "0:00";

    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  }

  escapeHtml(text) {
    if (!text) return "";
    
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  getHostname(url) {
    try {
      return new URL(url).hostname;
    } catch {
      return "Unknown";
    }
  }
}

// Initialize popup when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    console.log("DOM loaded, initializing popup...");
    new MediaControlsPopup();
  });
} else {
  console.log("DOM already loaded, initializing popup...");
  new MediaControlsPopup()
}