// Content script for detecting and controlling media elements
// Firefox-compatible version - FIXED

class MediaDetector {
  constructor() {
    this.currentMedia = null;
    this.mediaElements = new Set();
    this.lucidModeEnabled = false;
    this.isInitialized = false;
    this.lastReportedState = new Map(); // Track last reported state to avoid duplicates
    
    // Initialize immediately
    this.init();
  }

  init() {
    console.log("MediaDetector initializing...");
    
    // Wait for DOM to be ready before injecting script
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.injectMainScript());
    } else {
      this.injectMainScript();
    }

    // Listen for messages from background
    if (typeof browser !== 'undefined') {
      browser.runtime.onMessage.addListener((message) => {
        return this.handleMessage(message);
      });
    }

    // Listen for messages from injected script
    window.addEventListener("message", (event) => {
      if (event.source !== window || event.data.type !== "MEDIA_CONTROL_INTERNAL") return;
      this.handleInternalMessage(event.data);
    });

    // Start observing for media elements as backup
    this.observeMedia();
  }

  injectMainScript() {
    if (this.isInitialized) return;
    
    try {
      console.log("Injecting main script...");
      
      // Check if browser API is available
      if (typeof browser === 'undefined') {
        console.error("Browser API not available, falling back to direct detection");
        this.fallbackDirectDetection();
        return;
      }

      const script = document.createElement("script");
      script.src = browser.runtime.getURL("inject.js");
      script.async = false;
      
      script.onload = () => {
        console.log("Inject script loaded successfully");
        script.remove();
        this.isInitialized = true;
      };
      
      script.onerror = (error) => {
        console.error("Failed to inject script:", error);
        script.remove();
        this.fallbackDirectDetection();
      };

      // Insert into document
      const target = document.head || document.documentElement;
      if (target) {
        target.appendChild(script);
      } else {
        // If no head/documentElement yet, wait a bit
        setTimeout(() => this.injectMainScript(), 100);
      }
    } catch (error) {
      console.error("Error injecting script:", error);
      this.fallbackDirectDetection();
    }
  }

  fallbackDirectDetection() {
    console.log("Using fallback direct detection");
    this.isInitialized = true;
    
    // Direct detection without injection
    this.setupDirectMediaDetection();
  }

  setupDirectMediaDetection() {
    // Override media element prototypes directly
    const originalPlay = HTMLMediaElement.prototype.play;
    const originalPause = HTMLMediaElement.prototype.pause;

    HTMLMediaElement.prototype.play = function() {
      console.log("Direct play detection:", this);
      if (!this.dataset.mediaControlsDetected) {
        this.dataset.mediaControlsDetected = "true";
        window.dispatchEvent(new CustomEvent('mediaDetected', { detail: this }));
      }
      return originalPlay.apply(this, arguments);
    };

    HTMLMediaElement.prototype.pause = function() {
      console.log("Direct pause detection:", this);
      if (!this.dataset.mediaControlsDetected) {
        this.dataset.mediaControlsDetected = "true";
        window.dispatchEvent(new CustomEvent('mediaDetected', { detail: this }));
      }
      return originalPause.apply(this, arguments);
    };

    // Listen for custom events
    window.addEventListener('mediaDetected', (event) => {
      this.handleDirectMediaDetection(event.detail);
    });

    // Scan for existing media
    this.scanForExistingMedia();
  }

  handleDirectMediaDetection(element) {
    console.log("Handling direct media detection:", element);
    
    // Add event listeners
    const events = ['play', 'pause', 'timeupdate', 'volumechange', 'ended', 'loadedmetadata', 'seeking', 'seeked'];
    events.forEach(eventType => {
      element.addEventListener(eventType, () => {
        this.handleMediaEvent(element, eventType);
      });
    });

    // Check if already playing
    if (!element.paused && element.currentTime > 0) {
      this.handleMediaEvent(element, 'play');
    }
  }

  handleMediaEvent(element, eventType) {
    const mediaData = {
      paused: element.paused,
      currentTime: element.currentTime || 0,
      duration: element.duration || 0,
      volume: element.volume || 1,
      muted: element.muted || false,
      isVideo: element.tagName === "VIDEO",
      pictureInPicture: document.pictureInPictureElement === element,
      title: this.getMediaTitle(),
      artist: this.getMediaArtist(),
      artwork: this.getMediaArtwork(element),
      src: element.src || element.currentSrc || ""
    };

    console.log("Media event:", eventType, mediaData);

    if (eventType === 'ended') {
      this.reportMediaEnded();
    } else if (!element.paused || eventType === 'pause') {
      this.reportMediaDetected(mediaData);
    }
  }

  getMediaTitle() {
    if (navigator.mediaSession?.metadata?.title) {
      return navigator.mediaSession.metadata.title;
    }
    return document.title || "Unknown";
  }

  getMediaArtist() {
    if (navigator.mediaSession?.metadata?.artist) {
      return navigator.mediaSession.metadata.artist;
    }
    try {
      return new URL(location.href).hostname;
    } catch {
      return "Unknown";
    }
  }

  getMediaArtwork(element) {
    if (element.poster) {
      return element.poster;
    }
    if (navigator.mediaSession?.metadata?.artwork?.[0]) {
      return navigator.mediaSession.metadata.artwork[0].src;
    }
    return null;
  }

  scanForExistingMedia() {
    console.log("Scanning for existing media elements...");
    
    const scanMedia = () => {
      const mediaElements = document.querySelectorAll("video, audio");
      console.log(`Found ${mediaElements.length} media elements`);
      
      mediaElements.forEach((element) => {
        if (!element.dataset.mediaControlsDetected) {
          element.dataset.mediaControlsDetected = "true";
          console.log("Setting up existing media:", element.tagName, element.src || element.currentSrc);
          this.handleDirectMediaDetection(element);
        }
      });
    };

    // Scan immediately
    scanMedia();
    
    // Scan after delays to catch dynamically loaded media
    setTimeout(scanMedia, 1000);
    setTimeout(scanMedia, 3000);
    setTimeout(scanMedia, 5000);
  }

  handleMessage(message) {
    const { type, action, data } = message;
    if (type !== "MEDIA_CONTROL") return;

    console.log("Content script received message:", action, data);

    switch (action) {
      case "EXECUTE_CONTROL":
        this.executeControl(data);
        break;
      case "TOGGLE_LUCID_MODE":
        this.toggleLucidMode(data.enabled);
        break;
    }
  }

  handleInternalMessage(data) {
    const { action, data: messageData } = data;
    
    // Avoid duplicate reports by checking if state has changed
    if (messageData) {
      const stateKey = `${messageData.src}-${messageData.paused}-${messageData.currentTime.toFixed(1)}-${messageData.volume}-${messageData.muted}`;
      if (this.lastReportedState.get(messageData.src) === stateKey && action === "MEDIA_UPDATED") {
        return; // Skip if state hasn't changed significantly
      }
      this.lastReportedState.set(messageData.src, stateKey);
    }

    switch (action) {
      case "MEDIA_DETECTED":
        this.reportMediaDetected(messageData);
        break;
      case "MEDIA_UPDATED":
        this.reportMediaUpdated(messageData);
        break;
      case "MEDIA_ENDED":
        this.reportMediaEnded();
        break;
    }
  }

  executeControl({ action, value }) {
    console.log("Content script executing control:", action, value);
    
    // Send to injected script first
    window.postMessage({
      type: "MEDIA_CONTROL_INTERNAL",
      action: "EXECUTE_CONTROL",
      data: { action, value },
    }, "*");

    // Also try direct control as fallback with a delay
    setTimeout(() => {
      const mediaElements = document.querySelectorAll("video, audio");
      
      // Find the best target element
      let activeMedia = Array.from(mediaElements).find(el => !el.paused);
      if (!activeMedia && mediaElements.length > 0) {
        activeMedia = mediaElements[mediaElements.length - 1]; // Use last found element
      }
      
      if (activeMedia) {
        console.log("Fallback direct control on:", activeMedia.tagName);
        this.executeDirectControl(activeMedia, action, value);
      }
    }, 200);
  }

  executeDirectControl(element, action, value) {
    try {
      console.log("Direct control execution:", action, value, "on", element.tagName);
      
      switch (action) {
        case "play":
          const playPromise = element.play();
          if (playPromise) {
            playPromise.then(() => {
              console.log("Direct play successful");
            }).catch(e => {
              console.error("Direct play failed:", e);
            });
          }
          break;
        case "pause":
          element.pause();
          console.log("Direct pause executed");
          break;
        case "toggle":
          if (element.paused) {
            const togglePlayPromise = element.play();
            if (togglePlayPromise) {
              togglePlayPromise.then(() => {
                console.log("Direct toggle play successful");
              }).catch(e => {
                console.error("Direct toggle play failed:", e);
              });
            }
          } else {
            element.pause();
            console.log("Direct toggle pause executed");
          }
          break;
        case "volume":
          element.volume = Math.max(0, Math.min(1, value));
          if (element.muted && value > 0) {
            element.muted = false;
          }
          break;
        case "mute":
          element.muted = !element.muted;
          break;
        case "seek":
          if (element.duration && isFinite(element.duration)) {
            element.currentTime = Math.max(0, Math.min(element.duration, value));
          }
          break;
        case "picture-in-picture":
          if (element.tagName === "VIDEO") {
            if (document.pictureInPictureElement === element) {
              document.exitPictureInPicture().catch(e => console.error("Exit PiP failed:", e));
            } else {
              element.requestPictureInPicture().catch(e => console.error("Request PiP failed:", e));
            }
          }
          break;
      }
    } catch (error) {
      console.error("Error executing direct control:", error);
    }
  }

  toggleLucidMode(enabled) {
    this.lucidModeEnabled = enabled;
    this.applyLucidMode();
  }

  applyLucidMode() {
    let style = document.querySelector("style[data-lucid-mode]");
    if (this.lucidModeEnabled) {
      if (!style) {
        style = document.createElement("style");
        style.setAttribute("data-lucid-mode", "");
        style.textContent = `
          video {
            filter: contrast(1.2) brightness(1.1) saturate(1.1);
          }
        `;
        document.head.appendChild(style);
      }
    } else if (style) {
      style.remove();
    }
  }

  observeMedia() {
    // Observe for new media elements
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === 1) { // Element node
            if (node.tagName === "VIDEO" || node.tagName === "AUDIO") {
              if (!node.dataset.mediaControlsDetected) {
                console.log("New media element detected via observer:", node.tagName);
                this.handleDirectMediaDetection(node);
              }
            } else if (node.querySelector) {
              const mediaElements = node.querySelectorAll("video, audio");
              mediaElements.forEach(el => {
                if (!el.dataset.mediaControlsDetected) {
                  console.log("New nested media element detected:", el.tagName);
                  this.handleDirectMediaDetection(el);
                }
              });
            }
          }
        });
      });
    });

    observer.observe(document, {
      childList: true,
      subtree: true,
    });
  }

  reportMediaDetected(data) {
    console.log("Reporting media detected:", data);
    
    if (typeof browser !== 'undefined') {
      browser.runtime.sendMessage({
        type: "MEDIA_CONTROL",
        action: "MEDIA_DETECTED",
        data,
      }).catch(error => {
        console.error("Failed to send media detected message:", error);
      });
    }
  }

  reportMediaUpdated(data) {
    if (typeof browser !== 'undefined') {
      browser.runtime.sendMessage({
        type: "MEDIA_CONTROL",
        action: "MEDIA_UPDATED",
        data,
      }).catch(error => {
        console.error("Failed to send media updated message:", error);
      });
    }
  }

  reportMediaEnded() {
    if (typeof browser !== 'undefined') {
      browser.runtime.sendMessage({
        type: "MEDIA_CONTROL",
        action: "MEDIA_ENDED",
      }).catch(error => {
        console.error("Failed to send media ended message:", error);
      });
    }
  }
}

// Initialize detector
console.log("Content script loaded");
new MediaDetector();