// Global variables to manage extension state
let switchInterval = 30000; // Default interval is 30 seconds
let badgeVisible = true; // To track if the badge should be shown
let badgeColor = '#32cd32';
let pauseOnActivity = false;
let autoRefresh = true;
let activityPaused = false;
let autoScroll = false;
let pauseOnHover = false;
let scrollSpeed = 20;
let scrollToTop = false;
let scrollDelay = 5;

let windowStates = {}; // Map windowId to state { intervalId, running, loadingTabId, startGeneration }

// Save state to storage to persist across service worker restarts
function saveWindowStates() {
    const statesToSave = {};
    for (const windowId in windowStates) {
        statesToSave[windowId] = {
            running: windowStates[windowId].running,
            startGeneration: windowStates[windowId].startGeneration,
            loadingTabId: null // Reset loading state
        };
    }
    chrome.storage.local.set({ windowStates: statesToSave });
}

// Restore state on startup
chrome.storage.local.get('windowStates', (data) => {
    if (data.windowStates) {
        const savedStates = data.windowStates;
        for (const windowId in savedStates) {
            windowStates[windowId] = savedStates[windowId];
            windowStates[windowId].intervalId = null;
            windowStates[windowId].loadingTabId = null;

            if (windowStates[windowId].running) {
                // Verify window exists before restarting
                chrome.windows.get(parseInt(windowId), (win) => {
                    if (chrome.runtime.lastError || !win) {
                        delete windowStates[windowId];
                        saveWindowStates();
                    } else {
                        startCountdown(parseInt(windowId));
                        if ((autoScroll || pauseOnHover) && !activityPaused) startScrollingInActiveTab(parseInt(windowId));
                    }
                });
            }
        }
    }
});

// Clean up closed windows
chrome.windows.onRemoved.addListener((windowId) => {
    if (windowStates[windowId]) {
        clearInterval(windowStates[windowId].intervalId);
        delete windowStates[windowId];
        saveWindowStates();
    }
});

function getWindowState(windowId) {
    if (!windowStates[windowId]) {
        windowStates[windowId] = {
            intervalId: null,
            running: false,
            loadingTabId: null,
            startGeneration: 0,
            hoverPaused: false,
            secondsRemaining: 0
        };
    }
    // Ensure runtime properties exist (in case of restore from storage)
    if (!windowStates[windowId].hasOwnProperty('intervalId')) {
        windowStates[windowId].intervalId = null;
    }
    // Ensure hoverPaused exists
    if (!windowStates[windowId].hasOwnProperty('hoverPaused')) {
        windowStates[windowId].hoverPaused = false;
    }
    // Ensure secondsRemaining exists
    if (!windowStates[windowId].hasOwnProperty('secondsRemaining')) {
        windowStates[windowId].secondsRemaining = switchInterval / 1000;
    }
    return windowStates[windowId];
}

// Updates the badge text on the extension icon with the remaining seconds
function updateBadgeText(windowId, text, color) {
    if (!badgeVisible) return;
    const colorToUse = color || badgeColor;
    
    // Update badge on the active tab of the specific window
    chrome.tabs.query({active: true, windowId: windowId}, (tabs) => {
        if (tabs.length > 0) {
            chrome.action.setBadgeBackgroundColor({ color: colorToUse, tabId: tabs[0].id });
            chrome.action.setBadgeText({ text: text.toString(), tabId: tabs[0].id });
        }
    });
}

// Starts the countdown timer for the next tab switch
function startCountdown(windowId, resume = false) {
    const state = getWindowState(windowId);
    if (activityPaused || state.loadingTabId !== null || state.hoverPaused) return;

    if (!resume || state.secondsRemaining <= 0) {
        state.secondsRemaining = switchInterval / 1000;
    }

    updateBadgeText(windowId, state.secondsRemaining);

    clearInterval(state.intervalId);
    state.intervalId = setInterval(() => {
        state.secondsRemaining--;
        if (state.secondsRemaining <= 0) {
            clearInterval(state.intervalId);
            switchTab(windowId);
        }
        updateBadgeText(windowId, state.secondsRemaining);
    }, 1000);
}

// Switches to the next tab in the cycle
function switchTab(windowId) {
    const state = getWindowState(windowId);

    // Query all tabs in the saved window
    chrome.tabs.query({windowId: windowId}, function(tabs) {
        if (tabs.length <= 1) {
            return; // Don't switch if only one tab is open
        }

        // Find the currently active tab
        chrome.tabs.query({active: true, windowId: windowId}, function(activeTabs) {
            if (activeTabs.length === 0) return;

            let currentTabIndex = activeTabs[0].index;
            // Stop scrolling on the current tab before switching
            chrome.tabs.sendMessage(activeTabs[0].id, {command: "stopScrolling"}, () => {
                if (chrome.runtime.lastError) { /* Ignore */ }
            });
            // Clear badge from current tab
            chrome.action.setBadgeText({ text: "", tabId: activeTabs[0].id });

            let nextTabIndex = (currentTabIndex + 1) % tabs.length;

            let nextTabId = tabs[nextTabIndex].id;
            state.loadingTabId = nextTabId;

            // Switch to the next tab
            chrome.tabs.update(nextTabId, {active: true, autoDiscardable: false}, (tab) => {
                if (chrome.runtime.lastError) {
                    state.loadingTabId = null;
                    return;
                }
                // Handle auto-refresh logic
                if (autoRefresh) {
                    chrome.tabs.reload(nextTabId, {bypassCache: true}, () => {
                        if (chrome.runtime.lastError) {
                            state.loadingTabId = null;
                            startCountdown(windowId);
                        }
                    });
                } else {
                    chrome.tabs.get(nextTabId, (currentTab) => {
                        if (currentTab.status === 'complete') {
                            state.loadingTabId = null;
                            startCountdown(windowId);
                            if ((autoScroll || pauseOnHover) && !activityPaused) startScrollingInTab(nextTabId);
                        }
                    });
                }
            });
        });
    });
}

// Helper to initialize timer state (idle check, start countdown)
function initializeTimerState(windowId, currentGen) {
    const state = getWindowState(windowId);
    if (pauseOnActivity) {
        chrome.idle.queryState(15, (idleState) => {
            if (currentGen !== state.startGeneration || !state.running) return;

            if (idleState === 'active') {
                activityPaused = true;
                chrome.storage.local.set({activityPaused: true});
                updateBadgeText(windowId, "...", "#ff0000");
            } else {
                activityPaused = false;
                chrome.storage.local.set({activityPaused: false});
                startCountdown(windowId);
                if (autoScroll || pauseOnHover) startScrollingInActiveTab(windowId);
            }
        });
    } else {
        activityPaused = false;
        chrome.storage.local.set({activityPaused: false});
        startCountdown(windowId);
        if (autoScroll || pauseOnHover) startScrollingInActiveTab(windowId);
    }
}

// Initializes the tab switching process
function startTabSwitching(windowId) {
    const state = getWindowState(windowId);
    state.startGeneration++;
    state.running = true;
    saveWindowStates();
    initializeTimerState(windowId, state.startGeneration);
}

// Stops the tab switching process and clears state
function stopTabSwitching(windowId) {
    const state = getWindowState(windowId);
    state.startGeneration++;
    clearInterval(state.intervalId);
    state.running = false;
    state.loadingTabId = null;
    state.hoverPaused = false;
    saveWindowStates();
    
    // Clear badge from active tab in this window
    chrome.tabs.query({active: true, windowId: windowId}, (tabs) => {
        if (tabs.length > 0) {
            chrome.action.setBadgeText({ text: "", tabId: tabs[0].id });
        }
    });

    activityPaused = false;
    chrome.storage.local.set({activityPaused: false});
    stopScrollingInAllTabs(windowId);
}

// Shows the countdown badge
function showBadge() {
    badgeVisible = true;
    chrome.storage.local.set({badgeVisible: true});
    // Note: We can't easily update text for all windows here without iterating
    // but the next tick of startCountdown will handle it.
}

// Hides the countdown badge
function hideBadge() {
    badgeVisible = false;
    chrome.storage.local.set({badgeVisible: false});
    chrome.action.setBadgeText({ text: "" });
}

// Updates the switch interval dynamically
function updateSwitchInterval(newInterval) {
    switchInterval = newInterval;
    // Restart all running windows
    for (const windowId in windowStates) {
        if (windowStates[windowId].running) {
            startTabSwitching(parseInt(windowId));
        }
    }
}

// Load the saved interval value when the background script starts
chrome.storage.local.get('switchInterval', function(data) {
    if (data.switchInterval) {
        updateSwitchInterval(parseInt(data.switchInterval, 10) * 1000); // Convert to milliseconds
    }
});


// Restore state from local storage on startup
chrome.storage.local.get(['badgeVisible', 'pauseOnActivity', 'autoRefresh', 'activityPaused', 'autoScroll', 'pauseOnHover', 'scrollSpeed', 'scrollToTop', 'scrollDelay'], function(data) {
    // Note: We do not restore timerRunning state per window on restart as window IDs change
    badgeVisible = data.hasOwnProperty('badgeVisible') ? data.badgeVisible : true;
    pauseOnActivity = data.pauseOnActivity || false;
    autoRefresh = data.hasOwnProperty('autoRefresh') ? data.autoRefresh : true;
    if (data.activityPaused) activityPaused = data.activityPaused;
    if (data.hasOwnProperty('autoScroll')) autoScroll = data.autoScroll;
    if (data.hasOwnProperty('pauseOnHover')) pauseOnHover = data.pauseOnHover;
    if (data.scrollSpeed) scrollSpeed = data.scrollSpeed;
    if (data.hasOwnProperty('scrollToTop')) scrollToTop = data.scrollToTop;
    if (data.hasOwnProperty('scrollDelay')) scrollDelay = data.scrollDelay;
});

// Listen for messages from the popup script
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    if (request.command === "updateInterval") {
        updateSwitchInterval(parseInt(request.interval, 10) * 1000); // Convert to milliseconds
        chrome.storage.local.set({switchInterval: request.interval});
    } else if (request.command === "startTimer") {
        startTabSwitching(request.windowId);
    } else if (request.command === "stopTimer") {
        stopTabSwitching(request.windowId);
    } else if (request.command === "getTimerState") {
        const state = getWindowState(request.windowId);
        sendResponse({ running: state.running });
    }
    
    if (request.command === "showBadge") {
        showBadge();
    } else if (request.command === "hideBadge") {
        hideBadge();
    }
    
    if (request.command === "updateBadgeColor") {
        badgeColor = request.color;
        chrome.storage.local.set({badgeColor: badgeColor}); // Save the new color
    }
    
    if (request.command === "updatePauseOnActivity") {
        pauseOnActivity = request.pauseOnActivity;
        // Check all running windows
        for (const windowId in windowStates) {
            const state = windowStates[windowId];
            if (state.running) {
                if (pauseOnActivity) {
                    chrome.idle.queryState(15, (idleState) => {
                        if (idleState === 'active') {
                            clearInterval(state.intervalId);
                            updateBadgeText(parseInt(windowId), "...", "#ff0000");
                            activityPaused = true;
                            chrome.storage.local.set({activityPaused: true});
                        }
                    });
                } else if (activityPaused) {
                    startCountdown(parseInt(windowId), true);
                    activityPaused = false;
                    chrome.storage.local.set({activityPaused: false});
                }
            }
        }
    }

    if (request.command === "updateAutoRefresh") {
        autoRefresh = request.autoRefresh;
    }

    if (request.command === "updateAutoScroll") {
        autoScroll = request.autoScroll;
        if (!activityPaused) {
            for (const windowId in windowStates) {
                if (windowStates[windowId].running) {
                    if (autoScroll || pauseOnHover) startScrollingInActiveTab(parseInt(windowId), false);
                    else stopScrollingInActiveTab(parseInt(windowId));
                }
            }
        }
    }

    if (request.command === "updatePauseOnHover") {
        pauseOnHover = request.pauseOnHover;
        // If disabled, ensure we unpause any windows that were hover-paused
        if (!pauseOnHover) {
            for (const windowId in windowStates) {
                const state = windowStates[windowId];
                if (state.hoverPaused) {
                    state.hoverPaused = false;
                    if (state.running && !activityPaused && state.loadingTabId === null) startCountdown(parseInt(windowId), true);
                }
            }
        }
        if (!activityPaused) {
            for (const windowId in windowStates) {
                if (windowStates[windowId].running) {
                    if (autoScroll || pauseOnHover) startScrollingInActiveTab(parseInt(windowId), false);
                    else stopScrollingInActiveTab(parseInt(windowId));
                }
            }
        }
    }

    if (request.command === "updateScrollSpeed") {
        scrollSpeed = request.speed;
        if (autoScroll && !activityPaused) {
            // Update speed for all active tabs in running windows
            for (const windowId in windowStates) {
                if (windowStates[windowId].running) {
                    sendMessageToActiveTab(parseInt(windowId), {command: "updateSpeed", speed: scrollSpeed});
                }
            }
        }
    }

    if (request.command === "updateScrollToTop") {
        scrollToTop = request.scrollToTop;
    }

    if (request.command === "updateScrollDelay") {
        scrollDelay = request.scrollDelay;
    }

    if (request.command === "hoverStateChange") {
        if (sender.tab && sender.tab.active) {
            const windowId = sender.tab.windowId;
            const state = getWindowState(windowId);
            
            if (!state.running) return;

            state.hoverPaused = request.isHovering;

            if (state.hoverPaused) {
                clearInterval(state.intervalId);
                updateBadgeText(windowId, "||", "#ff0000");
            } else if (state.running && !activityPaused && state.loadingTabId === null) {
                startCountdown(windowId, true);
            }
        }
    }
});

// Load saved badge color
chrome.storage.local.get('badgeColor', function(data) {
    if (data.badgeColor) {
        badgeColor = data.badgeColor;
    }
});

// Set idle detection interval
chrome.idle.setDetectionInterval(15);

// Listen for tab updates to resume countdown after a tab finishes loading (for auto-refresh)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    const state = getWindowState(tab.windowId);
    if (state.loadingTabId !== null && tabId === state.loadingTabId && changeInfo.status === 'complete') {
        state.loadingTabId = null;
        startCountdown(tab.windowId);
        if ((autoScroll || pauseOnHover) && !activityPaused) startScrollingInTab(tabId);
    } else if (state.running && !activityPaused && (autoScroll || pauseOnHover) && changeInfo.status === 'complete') {
        // Ensure scrolling starts if the active tab finishes loading (e.g. manual refresh or wake from discard)
        if (tab.active) {
            startScrollingInTab(tabId);
        }
    }
});

// Listen for idle state changes to pause/resume switching
chrome.idle.onStateChanged.addListener((newState) => {
    chrome.storage.local.get(['pauseOnActivity', 'autoRefresh', 'switchInterval', 'activityPaused', 'badgeColor', 'autoScroll', 'scrollSpeed', 'scrollToTop', 'scrollDelay'], (data) => {
        if (!data.pauseOnActivity) return;

        // Restore state in case service worker restarted
        if (data.switchInterval) switchInterval = parseInt(data.switchInterval, 10) * 1000;
        activityPaused = data.activityPaused;
        autoRefresh = data.hasOwnProperty('autoRefresh') ? data.autoRefresh : true;
        autoScroll = data.hasOwnProperty('autoScroll') ? data.autoScroll : false;
        if (data.hasOwnProperty('pauseOnHover')) pauseOnHover = data.pauseOnHover;
        if (data.scrollSpeed) scrollSpeed = data.scrollSpeed;
        if (data.hasOwnProperty('scrollToTop')) scrollToTop = data.scrollToTop;
        if (data.hasOwnProperty('scrollDelay')) scrollDelay = data.scrollDelay;
        if (data.badgeColor) badgeColor = data.badgeColor;

        if (newState === 'active') {
            activityPaused = true;
            chrome.storage.local.set({activityPaused: true});

            for (const windowId in windowStates) {
                const state = windowStates[windowId];
                if (state.running) {
                    clearInterval(state.intervalId);
                    stopScrollingInActiveTab(parseInt(windowId));
                    updateBadgeText(parseInt(windowId), "...", "#ff0000");
                }
            }
        } else if (newState === 'idle' || newState === 'locked') {
            if (activityPaused) {
                activityPaused = false;
                chrome.storage.local.set({activityPaused: false});
                for (const windowId in windowStates) {
                    const state = windowStates[windowId];
                    if (state.running) {
                        startCountdown(parseInt(windowId), true);
                        if (autoScroll || pauseOnHover) startScrollingInActiveTab(parseInt(windowId), false);
                    }
                }
            }
        }
    });
});

// Helper to start scrolling in a specific tab
function startScrollingInTab(tabId, overrideScrollToTop = null) {
    const message = {
        command: "startScrolling", 
        speed: scrollSpeed, 
        delay: scrollDelay, 
        scrollToTop: (overrideScrollToTop !== null) ? overrideScrollToTop : scrollToTop,
        pauseOnHover: pauseOnHover,
        autoScroll: autoScroll
    };

    chrome.tabs.sendMessage(tabId, message, () => {
        if (chrome.runtime.lastError) { 
            // Content script might not be ready or injected. Try injecting it.
            chrome.scripting.executeScript({
                target: { tabId: tabId },
                files: ['content_scroll.js']
            }, () => {
                if (!chrome.runtime.lastError) {
                    chrome.tabs.sendMessage(tabId, message);
                }
            });
        }
    });
}

// Helper to start scrolling in the currently active tab of the saved window
function startScrollingInActiveTab(windowId, overrideScrollToTop = null) {
    if (!windowId) return;
    chrome.tabs.query({active: true, windowId: windowId}, (tabs) => {
        if (tabs.length > 0) startScrollingInTab(tabs[0].id, overrideScrollToTop);
    });
}

// Helper to stop scrolling in the currently active tab
function stopScrollingInActiveTab(windowId) {
    sendMessageToActiveTab(windowId, {command: "stopScrolling"});
}

// Helper to stop scrolling in all tabs of the saved window
function stopScrollingInAllTabs(windowId) {
    if (!windowId) return;
    chrome.tabs.query({windowId: windowId}, (tabs) => {
        tabs.forEach((tab) => {
            chrome.tabs.sendMessage(tab.id, {command: "stopScrolling"}, () => {
                if (chrome.runtime.lastError) { /* Ignore */ }
            });
        });
    });
}

function sendMessageToActiveTab(windowId, message) {
    if (!windowId) return;
    chrome.tabs.query({active: true, windowId: windowId}, (tabs) => {
        if (tabs.length > 0) {
            chrome.tabs.sendMessage(tabs[0].id, message, () => {
                if (chrome.runtime.lastError) { /* Ignore */ }
            });
        }
    });
}

// Listen for browser startup to handle auto-start
chrome.runtime.onStartup.addListener(() => {
    chrome.storage.local.get('autoStart', (data) => {
        if (data.autoStart) {
            chrome.windows.getLastFocused((window) => {
                if (window) {
                    startTabSwitching(window.id);
                }
            });
        }
    });
});

// Listen for new windows to handle auto-start
chrome.windows.onCreated.addListener((window) => {
    chrome.storage.local.get('autoStart', (data) => {
        if (data.autoStart) {
            startTabSwitching(window.id);
        }
    });
});