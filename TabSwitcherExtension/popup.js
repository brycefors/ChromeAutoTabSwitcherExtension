// Global state variables for the popup UI
let timerRunning = false;
let badgeVisible = true;
let initialSettings = {};
let currentWindowId = null;

document.addEventListener('DOMContentLoaded', function() {
    chrome.windows.getCurrent((currentWindow) => {
        currentWindowId = currentWindow.id;
        
        // Retrieve stored states for badge visibility, switch interval, and badge color
        chrome.storage.local.get(['badgeVisible', 'switchInterval', 'badgeColor', 'pauseOnActivity', 'autoRefresh', 'autoStart', 'autoScroll', 'pauseOnHover', 'scrollSpeed', 'scrollToTop', 'scrollDelay'], function(data) {
            badgeVisible = data.hasOwnProperty('badgeVisible') ? data.badgeVisible : true;

            // Check running state for THIS window via message
            chrome.runtime.sendMessage({command: "getTimerState", windowId: currentWindowId}, (response) => {
                timerRunning = response && response.running;
                updateButtonState();
            });

            // Set the interval in the UI
            let interval = data.switchInterval || 30; // Default to 30 seconds if not set
            document.getElementById('interval').value = interval;

            // Set the badge color in the UI
            let color = data.badgeColor || '#32cd32'; // Default to green if not set
            document.getElementById('badgeColor').value = color;

            // Set the pause mode
            let pauseOnActivity = data.pauseOnActivity || false;
            let pauseOnHover = data.hasOwnProperty('pauseOnHover') ? data.pauseOnHover : false;
            let pauseMode = 'disable';
            if (pauseOnActivity) pauseMode = 'activity';
            else if (pauseOnHover) pauseMode = 'hover';
            document.getElementById('pauseMode').value = pauseMode;

            // Set the auto refresh checkbox
            let autoRefresh = data.hasOwnProperty('autoRefresh') ? data.autoRefresh : true;
            document.getElementById('autoRefresh').checked = autoRefresh;

            // Set the auto start checkbox
            let autoStart = data.hasOwnProperty('autoStart') ? data.autoStart : false;
            document.getElementById('autoStart').checked = autoStart;

            // Set the auto scroll checkbox
            let autoScroll = data.hasOwnProperty('autoScroll') ? data.autoScroll : false;
            document.getElementById('autoScroll').checked = autoScroll;

            // Set the scroll to top checkbox
            let scrollToTop = data.hasOwnProperty('scrollToTop') ? data.scrollToTop : false;
            document.getElementById('scrollToTop').checked = scrollToTop;

            // Set the scroll delay
            let scrollDelay = data.hasOwnProperty('scrollDelay') ? data.scrollDelay : 5;
            document.getElementById('scrollDelay').value = scrollDelay;

            // Set the scroll speed slider
            let scrollSpeed = data.scrollSpeed || 20;
            document.getElementById('scrollSpeed').value = scrollSpeed;
            document.getElementById('scrollSpeedDisplay').textContent = scrollSpeed;

            // Update display when slider moves
            document.getElementById('scrollSpeed').addEventListener('input', function() {
                document.getElementById('scrollSpeedDisplay').textContent = this.value;
            });

            // Initialize initialSettings for change detection
            initialSettings = {
                switchInterval: interval,
                badgeColor: color,
                pauseMode: pauseMode,
                autoRefresh: autoRefresh,
                autoStart: autoStart,
                autoScroll: autoScroll,
                scrollToTop: scrollToTop,
                scrollDelay: scrollDelay,
                scrollSpeed: scrollSpeed
            };

            // Add event listeners for change detection
            const inputs = ['interval', 'pauseMode', 'autoRefresh', 'autoStart', 'autoScroll', 'scrollToTop', 'scrollDelay', 'scrollSpeed', 'badgeColor'];
            inputs.forEach(id => {
                const el = document.getElementById(id);
                if (el) {
                    el.addEventListener('input', checkUnsavedChanges);
                    el.addEventListener('change', checkUnsavedChanges);
                }
            });

            // Update the button states
            updateButtonState();
            updateBadgeButtonState();
        });
    });
});

function checkUnsavedChanges() {
    const currentSettings = {
        switchInterval: parseInt(document.getElementById('interval').value, 10) || 0,
        badgeColor: document.getElementById('badgeColor').value,
        pauseMode: document.getElementById('pauseMode').value,
        autoRefresh: document.getElementById('autoRefresh').checked,
        autoStart: document.getElementById('autoStart').checked,
        autoScroll: document.getElementById('autoScroll').checked,
        scrollToTop: document.getElementById('scrollToTop').checked,
        scrollDelay: parseInt(document.getElementById('scrollDelay').value, 10) || 0,
        scrollSpeed: parseInt(document.getElementById('scrollSpeed').value, 10) || 0
    };

    const hasChanges = JSON.stringify(initialSettings) !== JSON.stringify(currentSettings);
    const saveBtn = document.getElementById('saveAll');
    
    if (hasChanges) {
        saveBtn.classList.add('unsaved');
        saveBtn.textContent = 'Save Settings (Unsaved Changes)';
        document.getElementById('status').textContent = '';
    } else {
        saveBtn.classList.remove('unsaved');
        saveBtn.textContent = 'Save Settings';
    }
}

// Updates the text and style of the Start/Stop Timer button
function updateButtonState() {
    const button = document.getElementById('toggleTimer');
    button.textContent = timerRunning ? "Stop Timer" : "Start Timer";
    if (timerRunning) {
        button.classList.add('running');
    } else {
        button.classList.remove('running');
    }
}

// Updates the text of the Hide/Show Badge button
function updateBadgeButtonState() {
    document.getElementById('toggleBadge').textContent = badgeVisible ? "Hide Badge" : "Show Badge";
}

// Event listener for the "Save Settings" button
document.getElementById('saveAll').addEventListener('click', () => {
    let interval = parseInt(document.getElementById('interval').value, 10);
    // Validate interval (minimum 5 seconds)
    if (isNaN(interval) || interval < 5) {
        interval = 5;
        document.getElementById('interval').value = 5;
    }

    let pauseMode = document.getElementById('pauseMode').value;
    let pauseOnActivity = (pauseMode === 'activity');
    let pauseOnHover = (pauseMode === 'hover');
    let autoRefresh = document.getElementById('autoRefresh').checked;
    let autoStart = document.getElementById('autoStart').checked;
    let badgeColor = document.getElementById('badgeColor').value;
    let autoScroll = document.getElementById('autoScroll').checked;
    let scrollSpeed = parseInt(document.getElementById('scrollSpeed').value, 10);
    let scrollToTop = document.getElementById('scrollToTop').checked;
    let scrollDelay = parseInt(document.getElementById('scrollDelay').value, 10);

    // Save settings to local storage and notify background script
    chrome.storage.local.set({switchInterval: interval, pauseOnActivity: pauseOnActivity, autoRefresh: autoRefresh, autoStart: autoStart, badgeColor: badgeColor, autoScroll: autoScroll, pauseOnHover: pauseOnHover, scrollSpeed: scrollSpeed, scrollToTop: scrollToTop, scrollDelay: scrollDelay}, function() {
        document.getElementById('status').textContent = 'Settings saved.';
        
        // Stop the timer if it is running
        if (timerRunning) {
            timerRunning = false;
            updateButtonState();
            chrome.runtime.sendMessage({command: "stopTimer", windowId: currentWindowId});
        }

        // Update initialSettings to match the newly saved values
        initialSettings = {
            switchInterval: interval,
            badgeColor: badgeColor,
            pauseMode: pauseMode,
            autoRefresh: autoRefresh,
            autoStart: autoStart,
            autoScroll: autoScroll,
            scrollToTop: scrollToTop,
            scrollDelay: scrollDelay,
            scrollSpeed: scrollSpeed
        };
        checkUnsavedChanges();

        chrome.runtime.sendMessage({command: "updateInterval", interval: interval});
        chrome.runtime.sendMessage({command: "updatePauseOnActivity", pauseOnActivity: pauseOnActivity});
        chrome.runtime.sendMessage({command: "updateAutoRefresh", autoRefresh: autoRefresh});
        chrome.runtime.sendMessage({command: "updateBadgeColor", color: badgeColor});
        chrome.runtime.sendMessage({command: "updateAutoScroll", autoScroll: autoScroll});
        chrome.runtime.sendMessage({command: "updatePauseOnHover", pauseOnHover: pauseOnHover});
        chrome.runtime.sendMessage({command: "updateScrollSpeed", speed: scrollSpeed});
        chrome.runtime.sendMessage({command: "updateScrollToTop", scrollToTop: scrollToTop});
        chrome.runtime.sendMessage({command: "updateScrollDelay", scrollDelay: scrollDelay});
    });
});

// Event listener for the "Start/Stop Timer" button
document.getElementById('toggleTimer').addEventListener('click', () => {
    timerRunning = !timerRunning;
    updateButtonState();
    chrome.runtime.sendMessage({command: timerRunning ? "startTimer" : "stopTimer", windowId: currentWindowId});
});

// Event listener for the "Hide/Show Badge" button
document.getElementById('toggleBadge').addEventListener('click', () => {
    badgeVisible = !badgeVisible;
    updateBadgeButtonState();
    chrome.runtime.sendMessage({command: badgeVisible ? "showBadge" : "hideBadge"});
});
