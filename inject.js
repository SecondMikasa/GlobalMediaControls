// Injected script that runs in page context to access media elements
// Firefox-compatible version - FIXED

(() => {
  // Prevent multiple initializations
  if (window.mediaControlsInjected) {
    console.log("Media controls already injected, skipping");
    return;
  }
  window.mediaControlsInjected = true;

  console.log("Media controls inject script starting...");

  let currentMedia = null;
  const mediaElements = new Map(); // Use Map to track elements by ID
  let isInitialized = false;
  let mediaElementCounter = 0;

  // Override media methods to detect playback
  const originalPlay = HTMLMediaElement.prototype.play;
  const originalPause = HTMLMediaElement.prototype.pause;
  const originalLoad = HTMLMediaElement.prototype.load;

  HTMLMediaElement.prototype.play = function() {
    console.log("Play intercepted:", this.tagName, this.src || this.currentSrc);
    if (!this.dataset.mediaControlsInjected) {
      setupMediaElement(this);
    }
    const result = originalPlay.apply(this, arguments);
    
    // Handle promise-based play() for modern browsers
    if (result && typeof result.then === 'function') {
      result.then(() => {
        console.log("Play promise resolved");
        setTimeout(() => handleMediaEvent(this, 'play'), 50);
      }).catch(error => {
        console.log("Play promise rejected:", error);
      });
    } else {
      // Fallback for older browsers
      setTimeout(() => handleMediaEvent(this, 'play'), 50);
    }
    
    return result;
  };

  HTMLMediaElement.prototype.pause = function() {
    console.log("Pause intercepted:", this.tagName, this.src || this.currentSrc);
    if (!this.dataset.mediaControlsInjected) {
      setupMediaElement(this);
    }
    const result = originalPause.apply(this, arguments);
    setTimeout(() => handleMediaEvent(this, 'pause'), 50);
    return result;
  };

  HTMLMediaElement.prototype.load = function() {
    console.log("Load intercepted:", this.tagName, this.src || this.currentSrc);
    if (!this.dataset.mediaControlsInjected) {
      setupMediaElement(this);
    }
    const result = originalLoad.apply(this, arguments);
    setTimeout(() => handleMediaEvent(this, 'loadstart'), 50);
    return result;
  };

  function setupMediaElement(element) {
    if (element.dataset.mediaControlsInjected) {
      console.log("Element already set up");
      return;
    }

    const elementId = ++mediaElementCounter;
    console.log(`Setting up media element #${elementId}:`, element.tagName, element.src || element.currentSrc);
    
    element.dataset.mediaControlsInjected = "true";
    element.dataset.mediaControlsId = elementId;
    mediaElements.set(elementId, element);

    // Add comprehensive event listeners
    const events = [
      'loadstart', 'loadeddata', 'loadedmetadata', 'canplay', 'canplaythrough',
      'play', 'playing', 'pause', 'waiting', 'seeking', 'seeked',
      'timeupdate', 'volumechange', 'ended', 'error', 'abort', 'stalled'
    ];

    events.forEach(eventType => {
      element.addEventListener(eventType, (e) => {
        handleMediaEvent(element, eventType);
      }, { passive: true });
    });

    // Picture-in-picture events for video
    if (element.tagName === "VIDEO") {
      element.addEventListener("enterpictureinpicture", () => {
        console.log("Video entered PiP");
        handleMediaEvent(element, "enterpictureinpicture");
      });
      element.addEventListener("leavepictureinpicture", () => {
        console.log("Video left PiP");
        handleMediaEvent(element, "leavepictureinpicture");
      });
    }

    // Check if media is already in a playable state
    if (element.readyState >= 2) { // HAVE_CURRENT_DATA
      console.log(`Element #${elementId} is already ready`);
      handleMediaEvent(element, 'canplay');
      
      // Check if it's already playing
      if (!element.paused && element.currentTime > 0) {
        console.log(`Element #${elementId} is already playing`);
        handleMediaEvent(element, 'play');
      }
    }
  }

  function handleMediaEvent(element, eventType) {
    const elementId = parseInt(element.dataset.mediaControlsId);
    
    // Don't process events for elements without valid duration (except initial events)
    const initialEvents = ['loadstart', 'loadeddata', 'loadedmetadata', 'canplay', 'canplaythrough'];
    if (!initialEvents.includes(eventType)) {
      if (!element.duration || element.duration === 0 || !isFinite(element.duration)) {
        return;
      }
    }

    const isPlaying = !element.paused && !element.ended && element.currentTime >= 0 && element.readyState > 2;
    const wasPlaying = currentMedia === element;

    if (isPlaying && !wasPlaying) {
      console.log(`Element #${elementId} became current media`);
      currentMedia = element;
    } else if (!isPlaying && wasPlaying) {
      console.log(`Element #${elementId} is no longer current media`);
      currentMedia = null;
    }

    const mediaData = {
      paused: element.paused,
      currentTime: element.currentTime || 0,
      duration: element.duration || 0,
      volume: element.volume || 1,
      muted: element.muted || false,
      isVideo: element.tagName === "VIDEO",
      pictureInPicture: document.pictureInPictureElement === element,
      title: getMediaTitle(),
      artist: getMediaArtist(),
      artwork: getMediaArtwork(element),
      src: element.src || element.currentSrc || "",
      elementId: elementId
    };

    // Determine action to send
    let action;
    if (eventType === "ended" && !hasPlayingMedia()) {
      action = "MEDIA_ENDED";
    } else if (isPlaying || ['play', 'playing'].includes(eventType)) {
      action = currentMedia === element ? "MEDIA_DETECTED" : "MEDIA_UPDATED";
    } else if (['pause', 'timeupdate', 'volumechange', 'seeking', 'seeked'].includes(eventType)) {
      action = "MEDIA_UPDATED";
    } else if (initialEvents.includes(eventType)) {
      action = "MEDIA_DETECTED";
    } else {
      return;
    }

    try {
      if (action === "MEDIA_ENDED") {
        window.postMessage({
          type: "MEDIA_CONTROL_INTERNAL",
          action: action,
        }, "*");
      } else {
        window.postMessage({
          type: "MEDIA_CONTROL_INTERNAL",
          action: action,
          data: mediaData,
        }, "*");
      }
    } catch (error) {
      console.error("Error posting message:", error);
    }
  }

  function hasPlayingMedia() {
    return Array.from(mediaElements.values()).some((el) => {
      return !el.paused && !el.ended && el.currentTime >= 0 && el.readyState > 2;
    });
  }

  function getMediaTitle() {
    if (navigator.mediaSession?.metadata?.title) {
      return navigator.mediaSession.metadata.title;
    }
    return document.title || "Unknown";
  }

  function getMediaArtist() {
    if (navigator.mediaSession?.metadata?.artist) {
      return navigator.mediaSession.metadata.artist;
    }
    try {
      return new URL(location.href).hostname;
    } catch {
      return "Unknown";
    }
  }

  function getMediaArtwork(element) {
    if (element.poster) {
      return element.poster;
    }
    if (navigator.mediaSession?.metadata?.artwork?.[0]) {
      return navigator.mediaSession.metadata.artwork[0].src;
    }
    return null;
  }

  // Listen for control commands
  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data.type !== "MEDIA_CONTROL_INTERNAL") {
      return;
    }

    const { action, data } = event.data;
    console.log("Received control command:", action, data);

    if (action === "EXECUTE_CONTROL") {
      executeMediaControl(data);
    }
  });

  function executeMediaControl({ action, value }) {
    console.log("Executing media control:", action, value);

    // Find the target element - prioritize currently playing media
    let targetElement = currentMedia;
    
    if (!targetElement) {
      // Find any playing media
      targetElement = Array.from(mediaElements.values()).find(el => !el.paused && !el.ended);
    }
    
    if (!targetElement && mediaElements.size > 0) {
      // Use the most recently added media element
      const elements = Array.from(mediaElements.values());
      targetElement = elements[elements.length - 1];
    }

    if (!targetElement) {
      console.error("No media element found to control");
      return;
    }

    const elementId = targetElement.dataset.mediaControlsId;
    console.log("Controlling element:", targetElement.tagName, "ID:", elementId, "Current paused:", targetElement.paused);

    try {
      switch (action) {
        case "play":
          console.log("Executing play command");
          const playPromise = targetElement.play();
          if (playPromise) {
            playPromise.then(() => {
              console.log("Play successful");
            }).catch(e => {
              console.error("Play failed:", e);
            });
          }
          break;
          
        case "pause":
          console.log("Executing pause command");
          targetElement.pause();
          console.log("Pause executed, new paused state:", targetElement.paused);
          break;
          
        case "toggle":
          console.log("Executing toggle command, current paused:", targetElement.paused);
          if (targetElement.paused) {
            console.log("Playing media...");
            const togglePlayPromise = targetElement.play();
            if (togglePlayPromise) {
              togglePlayPromise.then(() => {
                console.log("Toggle play successful");
              }).catch(e => {
                console.error("Toggle play failed:", e);
              });
            }
          } else {
            console.log("Pausing media...");
            targetElement.pause();
            console.log("Toggle pause executed, new paused state:", targetElement.paused);
          }
          break;
          
        case "volume":
          console.log("Setting volume to:", value);
          targetElement.volume = Math.max(0, Math.min(1, value));
          if (targetElement.muted && value > 0) {
            targetElement.muted = false;
          }
          break;
          
        case "mute":
          console.log("Toggling mute, current muted:", targetElement.muted);
          targetElement.muted = !targetElement.muted;
          break;
          
        case "seek":
          console.log("Seeking to:", value);
          if (targetElement.duration && isFinite(targetElement.duration)) {
            targetElement.currentTime = Math.max(0, Math.min(targetElement.duration, value));
          }
          break;
          
        case "picture-in-picture":
          if (targetElement.tagName === "VIDEO") {
            console.log("Toggling PiP, current PiP element:", document.pictureInPictureElement);
            if (document.pictureInPictureElement === targetElement) {
              document.exitPictureInPicture().catch(e => console.error("Exit PiP failed:", e));
            } else {
              targetElement.requestPictureInPicture().catch(e => console.error("Request PiP failed:", e));
            }
          }
          break;
          
        default:
          console.warn("Unknown control action:", action);
      }

      // Force an update after control action
      setTimeout(() => {
        handleMediaEvent(targetElement, targetElement.paused ? 'pause' : 'play');
      }, 100);

    } catch (error) {
      console.error("Error executing media control:", error);
    }
  }

  // Initial scan for existing media elements
  function scanExistingMedia() {
    console.log("Scanning for existing media elements...");
    
    const existingMedia = document.querySelectorAll("video, audio");
    console.log(`Found ${existingMedia.length} existing media elements`);

    existingMedia.forEach((element, index) => {
      if (!element.dataset.mediaControlsInjected) {
        console.log(`Setting up existing media element ${index + 1}:`, element.tagName, element.src || element.currentSrc);
        setupMediaElement(element);
      }
    });
  }

  function initializeWhenReady() {
    if (isInitialized) return;
    
    console.log("Initializing media detection, document ready state:", document.readyState);
    scanExistingMedia();
    isInitialized = true;
  }

  // Initialize based on document state
  if (document.readyState === "loading") {
    console.log("Document still loading, waiting for DOMContentLoaded");
    document.addEventListener("DOMContentLoaded", initializeWhenReady);
  } else {
    console.log("Document already loaded, initializing immediately");
    initializeWhenReady();
  }

  // Scan with delays to catch dynamically loaded media
  setTimeout(() => {
    console.log("Scanning for media after 1 second...");
    scanExistingMedia();
  }, 1000);

  setTimeout(() => {
    console.log("Scanning for media after 3 seconds...");
    scanExistingMedia();
  }, 3000);

  // Observe for new media elements
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === 1) { // Element node
          if (node.tagName === "VIDEO" || node.tagName === "AUDIO") {
            console.log("New media element detected via mutation:", node.tagName);
            setupMediaElement(node);
          } else if (node.querySelector) {
            const newMediaElements = node.querySelectorAll("video, audio");
            if (newMediaElements.length > 0) {
              console.log(`Found ${newMediaElements.length} new media elements in added node`);
              newMediaElements.forEach(setupMediaElement);
            }
          }
        }
      });
    });
  });

  observer.observe(document, {
    childList: true,
    subtree: true,
  });

  console.log("Media controls injection complete");
})();