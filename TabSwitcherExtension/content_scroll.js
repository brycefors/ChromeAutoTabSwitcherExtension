if (typeof window.tabSwitcherScrollInjected === 'undefined') {
    window.tabSwitcherScrollInjected = true;

    let scrollIntervalId = null;
    let scrollTimeoutId = null;
    let resumeTimeoutId = null;
    
    // State
    let isScrollingActive = false; // True after delay has passed
    let currentSpeed = 20;
    let currentDelay = 0;
    let pauseOnHover = false;
    let isHovering = false;
    let isResumeDelaying = false;

    // Listeners for hover
    document.addEventListener('mouseover', () => {
        if (!isHovering) {
            isHovering = true;
            if (isResumeDelaying) {
                isResumeDelaying = false;
                if (resumeTimeoutId) {
                    clearTimeout(resumeTimeoutId);
                    resumeTimeoutId = null;
                }
            }
            checkScrollStatus();
        }
    });
    
    document.addEventListener('mouseout', (e) => {
        // If relatedTarget is null, mouse left the window/document
        if (e.relatedTarget === null) {
            isHovering = false;
            
            if (pauseOnHover && currentDelay > 0 && isScrollingActive) {
                isResumeDelaying = true;
                checkScrollStatus();
                
                if (resumeTimeoutId) clearTimeout(resumeTimeoutId);
                resumeTimeoutId = setTimeout(() => {
                    isResumeDelaying = false;
                    resumeTimeoutId = null;
                    checkScrollStatus();
                }, currentDelay * 1000);
            } else {
                checkScrollStatus();
            }
        }
    });

    function checkScrollStatus() {
        // If we should be scrolling (active) AND (not pausing on hover OR not hovering)
        if (isScrollingActive && (!pauseOnHover || !isHovering) && !isResumeDelaying) {
            startInterval();
        } else {
            stopInterval();
        }

        // Notify background to pause/resume tab switching if enabled
        if (pauseOnHover) {
            let effectiveHover = isHovering || isResumeDelaying;

            if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
                pauseOnHover = false;
                return;
            }

            try {
                chrome.runtime.sendMessage({
                    command: "hoverStateChange",
                    isHovering: effectiveHover
                }, () => {
                    try {
                        // Accessing lastError suppresses "Unchecked runtime.lastError"
                        void chrome.runtime.lastError;
                    } catch (e) {}
                });
            } catch (e) {
                // Extension context invalidated
                pauseOnHover = false;
            }
        }
    }

    function startInterval() {
        if (scrollIntervalId) return; // Already running
        const intervalDelay = Math.max(5, 105 - currentSpeed);
        scrollIntervalId = setInterval(() => {
            window.scrollBy(0, 1);
        }, intervalDelay);
    }

    function stopInterval() {
        if (scrollIntervalId) {
            clearInterval(scrollIntervalId);
            scrollIntervalId = null;
        }
    }

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.command === "startScrolling") {
            stopScrollingFull(); // Reset everything
            
            if (request.scrollToTop && request.autoScroll) {
                window.scrollTo(0, 0);
            }
            
            currentSpeed = request.speed;
            pauseOnHover = request.pauseOnHover;
            currentDelay = request.delay;
            
            // Handle delay
            if (request.autoScroll) {
                if (request.delay > 0) {
                    scrollTimeoutId = setTimeout(() => {
                        isScrollingActive = true;
                        checkScrollStatus();
                    }, request.delay * 1000);
                } else {
                    isScrollingActive = true;
                    checkScrollStatus();
                }
            } else {
                checkScrollStatus();
            }

        } else if (request.command === "stopScrolling") {
            stopScrollingFull();
        } else if (request.command === "updateSpeed") {
            currentSpeed = request.speed;
            // If currently running, restart interval with new speed
            if (scrollIntervalId) {
                stopInterval();
                startInterval();
            }
        } else if (request.command === "updatePauseOnHover") {
            pauseOnHover = request.pauseOnHover;
            checkScrollStatus();
        }
    });

    function stopScrollingFull() {
        isScrollingActive = false;
        isResumeDelaying = false;
        stopInterval();
        if (scrollTimeoutId) {
            clearTimeout(scrollTimeoutId);
            scrollTimeoutId = null;
        }
        if (resumeTimeoutId) {
            clearTimeout(resumeTimeoutId);
            resumeTimeoutId = null;
        }
    }
}