// Crossword grid setup
const GRID_SIZE = 15;
let currentCell = null;
let lastUpdateId = 0;
let inputTimeouts = new Map(); // Store timeouts for each cell
let isSetupMode = false; // Track current mode - default to game mode
let isBrushMode = false; // Track black square brush mode
let isMouseDown = false; // Track mouse state for dragging
let brushPaintMode = null; // 'black' or 'white' - set on mousedown

// DOM elements - will be initialized when DOM is ready
let gridElement, acrossCluesList, downCluesList, connectionDot, clientCountElement;
let activeClueDisplay, activeClueNumber, activeClueText;

// Client tracking - generate unique ID per tab/session (not persistent)
let clientId = `client-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
console.log('Client ID for this tab:', clientId);

// User color selection - persist across page reloads
let userColor = localStorage.getItem('userColor') || 'blue';

// User presence tracking
let currentUserPosition = null; // { type: 'cell', row: number, col: number } or { type: 'clue', direction: string, number: string }
let lastSentPosition = null;
let otherUsers = new Map(); // clientId -> { color, position }

// Color theme definitions
const colorThemes = {
    blue: { primary: '#3b82f6', light: '#dbeafe', border: '#93c5fd' },
    red: { primary: '#ef4444', light: '#fee2e2', border: '#fca5a5' },
    green: { primary: '#10b981', light: '#d1fae5', border: '#6ee7b7' },
    purple: { primary: '#8b5cf6', light: '#ede9fe', border: '#c4b5fd' },
    orange: { primary: '#f59e0b', light: '#fef3c7', border: '#fcd34d' },
    pink: { primary: '#ec4899', light: '#fce7f3', border: '#f9a8d4' },
    teal: { primary: '#14b8a6', light: '#ccfbf1', border: '#5eead4' },
    indigo: { primary: '#6366f1', light: '#e0e7ff', border: '#a5b4fc' }
};

// Context-aware clue editing
let activeWordCells = [];
let currentClueDirection = null;
let currentClueNumber = null;
let clueTypingPosition = 0;

// Double-tap detection for switching between across/down
let lastFocusedCell = null;
let lastFocusTime = 0;
const DOUBLE_TAP_DELAY = 500; // milliseconds

// Auto-resize textarea function
function autoResizeTextarea(textarea) {
    // Reset height to auto to get the correct scrollHeight
    textarea.style.height = 'auto';
    // Calculate single line height based on font size and line height
    const singleLineHeight = Math.ceil(13 * 1.3) + 4; // font-size * line-height + padding
    // Set height to scrollHeight but ensure it's at least one line
    textarea.style.height = Math.max(textarea.scrollHeight, singleLineHeight) + 'px';
}

// Color selection functions
function selectUserColor(color) {
    userColor = color;
    localStorage.setItem('userColor', color);
    
    // Update UI to show selected color
    document.querySelectorAll('.color-option').forEach(btn => {
        btn.classList.remove('selected');
    });
    document.querySelector(`[data-color="${color}"]`).classList.add('selected');
    
    // Apply color theme to current highlights
    updateColorTheme();
    
    // Send updated presence with new color
    if (currentUserPosition) {
        sendPresenceUpdate(currentUserPosition);
    }
    
    console.log('User color changed to:', color);
}

function updateColorTheme() {
    const theme = colorThemes[userColor];
    
    // Update CSS custom properties for dynamic theming
    document.documentElement.style.setProperty('--user-primary', theme.primary);
    document.documentElement.style.setProperty('--user-light', theme.light);
    document.documentElement.style.setProperty('--user-border', theme.border);
    
    // Re-apply highlighting with new color if there's an active word
    if (currentClueDirection && currentClueNumber) {
        highlightWord(currentClueDirection, currentClueNumber);
    }
}

function initializeColorSelection() {
    // Set initial color selection
    document.querySelector(`[data-color="${userColor}"]`).classList.add('selected');
    updateColorTheme();
}

// Helper function to adjust color brightness
function adjustColorBrightness(hex, percent) {
    // Remove # if present
    hex = hex.replace('#', '');
    
    // Convert to RGB
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    
    // For darkening (negative percent), use a simpler approach
    if (percent < 0) {
        const factor = 1 + (percent / 100);
        const newR = Math.max(0, Math.round(r * factor));
        const newG = Math.max(0, Math.round(g * factor));
        const newB = Math.max(0, Math.round(b * factor));
        
        // Convert back to hex
        const toHex = (c) => {
            const hex = c.toString(16);
            return hex.length === 1 ? '0' + hex : hex;
        };
        
        const result = `#${toHex(newR)}${toHex(newG)}${toHex(newB)}`;
        console.log(`Color adjustment: ${hex} -> ${result} (${percent}%)`);
        return result;
    }
    
    // For lightening (positive percent)
    const newR = Math.min(255, Math.round(r + (255 - r) * (percent / 100)));
    const newG = Math.min(255, Math.round(g + (255 - g) * (percent / 100)));
    const newB = Math.min(255, Math.round(b + (255 - b) * (percent / 100)));
    
    // Convert back to hex
    const toHex = (c) => {
        const hex = c.toString(16);
        return hex.length === 1 ? '0' + hex : hex;
    };
    
    const result = `#${toHex(newR)}${toHex(newG)}${toHex(newB)}`;
    console.log(`Color adjustment: ${hex} -> ${result} (${percent}%)`);
    return result;
}

// Initialize HTTP polling
async function initializePolling() {
    console.log('Initializing HTTP polling...');
    
    // Load initial state and immediately check for any pending updates
    await loadInitialState();
    await checkForImmediateUpdates();
    
    // Start polling for updates
    startPolling();
    
    connectionDot.className = 'connection-dot connected';
}

// Load initial state from server
async function loadInitialState() {
    try {
        const response = await fetch('/api/state', {
            headers: { 'X-Client-ID': clientId }
        });
        const gameState = await response.json();
        
        console.log('Loaded initial state:', gameState);
        
        // Update grid
        Object.keys(gameState.grid).forEach(key => {
            const [row, col] = key.split('-').map(Number);
            const container = document.getElementById(`container-${row}-${col}`);
            const cell = document.getElementById(`cell-${row}-${col}`);
            const numberSpan = document.getElementById(`number-${row}-${col}`);
            const cellData = gameState.grid[key];
            
            if (container && cell && numberSpan && cellData) {
                if (cellData.isBlack) {
                    container.classList.add('black');
                    cell.disabled = true;
                    cell.value = '';
                    numberSpan.textContent = '';
                } else {
                    container.classList.remove('black');
                    cell.disabled = false;
                    cell.value = cellData.value || '';
                    numberSpan.textContent = cellData.number || '';
                }
            }
        });
        
        // Update clues
        updateCluesDisplay('across', gameState.clues.across || {});
        updateCluesDisplay('down', gameState.clues.down || {});
        
        // Update client count
        if (gameState.clientCount) {
            clientCountElement.textContent = gameState.clientCount;
        }
        
        // Update user presence
        if (gameState.userPresence) {
            console.log('=== RECEIVED INITIAL PRESENCE DATA ===');
            console.log('Raw presence data:', gameState.userPresence);
            updateUserPresence(gameState.userPresence);
        } else {
            console.log('No initial presence data received');
        }
        
    } catch (error) {
        console.error('Failed to load initial state:', error);
        connectionDot.className = 'connection-dot';
    }
}

// Check for any pending updates immediately after loading initial state
async function checkForImmediateUpdates() {
    try {
        const response = await fetch(`/api/updates?since=${lastUpdateId}`, {
            headers: { 'X-Client-ID': clientId }
        });
        const updates = await response.json();
        
        console.log('Checking for immediate updates:', updates);
        
        updates.forEach(update => {
            console.log('=== IMMEDIATE UPDATE ===');
            console.log('Update type:', update.type);
            console.log('Update data:', update.data);
            
            if (update.type === 'client-count') {
                clientCountElement.textContent = update.clientCount;
            } else if (update.type === 'presence-update') {
                console.log('Processing immediate presence update!');
                handlePresenceUpdate(update.data);
                lastUpdateId = Math.max(lastUpdateId, update.id);
            } else {
                handleServerUpdate(update.data);
                lastUpdateId = Math.max(lastUpdateId, update.id);
            }
        });
        
    } catch (error) {
        console.error('Failed to check immediate updates:', error);
    }
}

// Start polling for updates
function startPolling() {
    const pollForUpdates = async () => {
        try {
            const response = await fetch(`/api/updates?since=${lastUpdateId}`, {
                headers: { 'X-Client-ID': clientId }
            });
            const updates = await response.json();
            
            updates.forEach(update => {
                console.log('=== RECEIVED UPDATE ===');
                console.log('Update type:', update.type);
                console.log('Update data:', update.data);
                
                if (update.type === 'client-count') {
                    clientCountElement.textContent = update.clientCount;
                } else if (update.type === 'presence-update') {
                    console.log('Processing presence update!');
                    handlePresenceUpdate(update.data);
                    lastUpdateId = Math.max(lastUpdateId, update.id);
                } else {
                    handleServerUpdate(update.data);
                    lastUpdateId = Math.max(lastUpdateId, update.id);
                }
            });
            
            connectionDot.className = 'connection-dot connected';
            
        } catch (error) {
            console.error('Polling error:', error);
            connectionDot.className = 'connection-dot';
        }
        
        // Poll again in 1 second
        setTimeout(pollForUpdates, 1000);
    };
    
    // Start polling
    setTimeout(pollForUpdates, 1000);
}

// Handle updates from server
function handleServerUpdate(data) {
    if (data.type === 'grid-update') {
        // Update specific grid cell
        const [row, col] = data.key.split('-').map(Number);
        const container = document.getElementById(`container-${row}-${col}`);
        const cell = document.getElementById(`cell-${row}-${col}`);
        const numberSpan = document.getElementById(`number-${row}-${col}`);
        const cellData = data.value;
        
        if (container && cell && numberSpan && cellData) {
            if (cellData.isBlack) {
                container.classList.add('black');
                cell.disabled = true;
                cell.value = '';
                numberSpan.textContent = '';
            } else {
                container.classList.remove('black');
                cell.disabled = false;
                if (cell.value !== cellData.value) {
                    cell.value = cellData.value || '';
                }
                numberSpan.textContent = cellData.number || '';
            }
        }
        
    } else if (data.type === 'clue-update') {
        // Update specific clue
        updateSingleClue(data.direction, data.number, data.text);
    } else if (data.type === 'clue-delete') {
        // Delete specific clue
        deleteSingleClue(data.direction, data.number);
    } else if (data.type === 'clear-all') {
        // Clear everything
        clearLocalGrid();
    }
}

// Send update to server
async function sendToServer(data) {
    try {
        await fetch('/api/update', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Client-ID': clientId
            },
            body: JSON.stringify(data)
        });
    } catch (error) {
        console.error('Failed to send update:', error);
    }
}

// Send user presence update to server
async function sendPresenceUpdate(position) {
    console.log('=== SENDING PRESENCE UPDATE ===');
    console.log('Position:', position);
    console.log('Client ID:', clientId);
    console.log('User Color:', userColor);
    
    // Don't spam the server with identical position updates
    if (JSON.stringify(position) === JSON.stringify(lastSentPosition)) {
        console.log('Skipping identical position update');
        return;
    }
    
    currentUserPosition = position;
    lastSentPosition = position ? JSON.parse(JSON.stringify(position)) : null;
    
    try {
        const response = await fetch('/api/presence', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Client-ID': clientId
            },
            body: JSON.stringify({
                clientId: clientId,
                color: userColor,
                position: position
            })
        });
        
        const result = await response.text();
        console.log('Presence update response:', result);
        
    } catch (error) {
        console.error('Failed to send presence update:', error);
    }
}

// Handle presence updates from other users
function handlePresenceUpdate(data) {
    console.log('Received presence update:', data);
    
    // Don't process our own presence updates
    if (data.clientId === clientId) {
        console.log('Ignoring own presence update');
        return;
    }
    
    console.log('Processing presence update for other user:', data.clientId);
    
    // Update other users map
    if (data.position) {
        otherUsers.set(data.clientId, {
            color: data.color,
            position: data.position
        });
        console.log('Updated user position:', data.clientId, data.position);
    } else {
        // User disconnected or cleared position
        otherUsers.delete(data.clientId);
        console.log('Removed user:', data.clientId);
    }
    
    // Update visual indicators
    updateOtherUsersDisplay();
}

// Update initial user presence from server state
function updateUserPresence(presenceArray) {
    console.log('=== INITIAL PRESENCE DATA ===');
    console.log('Presence array:', presenceArray);
    console.log('Our client ID:', clientId);
    
    // Clear existing data
    otherUsers.clear();
    
    // Populate with current presence data
    presenceArray.forEach(user => {
        console.log('Processing user:', user.clientId, 'vs our ID:', clientId);
        if (user.clientId !== clientId && user.position) {
            console.log('Adding other user:', user.clientId, user.position);
            otherUsers.set(user.clientId, {
                color: user.color,
                position: user.position
            });
        }
    });
    
    // Update visual indicators
    updateOtherUsersDisplay();
}

// Update visual indicators for other users
function updateOtherUsersDisplay() {
    console.log('=== UPDATING VISUAL INDICATORS ===');
    console.log('Active users:', otherUsers.size);
    console.log('User data:', Array.from(otherUsers.entries()));
    
    // Clear all existing other-user indicators with detailed logging
    const indicators = document.querySelectorAll('.other-user-indicator');
    const activeCells = document.querySelectorAll('.cell-container.other-user-active-cell');
    const wordHighlights = document.querySelectorAll('.cell-container.other-user-word-highlight');
    const clueHighlights = document.querySelectorAll('.clue-item.other-user-clue');
    
    // Also check for any containers that might have stale styling
    const allContainers = document.querySelectorAll('.cell-container');
    const allClueItems = document.querySelectorAll('.clue-item');
    
    console.log('Cleaning up:', {
        indicators: indicators.length,
        activeCells: activeCells.length, 
        wordHighlights: wordHighlights.length,
        clueHighlights: clueHighlights.length
    });
    
    indicators.forEach(el => el.remove());
    activeCells.forEach(container => {
        container.classList.remove('other-user-active-cell');
        container.style.removeProperty('background-color');
        container.style.removeProperty('border-color');
        container.style.removeProperty('border');
    });
    wordHighlights.forEach(container => {
        container.classList.remove('other-user-word-highlight');
        container.style.removeProperty('background-color');
        container.style.removeProperty('border-color');
        container.style.removeProperty('border');
    });
    clueHighlights.forEach(item => {
        item.classList.remove('other-user-clue');
        item.style.removeProperty('border-left-color');
        item.style.removeProperty('border-color');
        item.style.removeProperty('border');
    });
    
    // Additional comprehensive cleanup for any stale styling
    allContainers.forEach(container => {
        if (container.classList.contains('other-user-active-cell') || 
            container.classList.contains('other-user-word-highlight')) {
            container.classList.remove('other-user-active-cell', 'other-user-word-highlight');
            container.style.removeProperty('background-color');
            container.style.removeProperty('border-color');
            container.style.removeProperty('border');
        }
    });
    
    allClueItems.forEach(item => {
        if (item.classList.contains('other-user-clue')) {
            item.classList.remove('other-user-clue');
            item.style.removeProperty('border-left-color');
            item.style.removeProperty('border-color');
            item.style.removeProperty('border');
        }
    });
    
    console.log('Comprehensive cleanup complete. Now adding new indicators...');
    
    // Add indicators for each active user
    otherUsers.forEach((userData, userId) => {
        const { color, position } = userData;
        const theme = colorThemes[color];
        
        console.log(`Adding indicator for user ${userId} at`, position, 'with color', color);
        
        if (position.type === 'cell') {
            // Show active cell with darker background
            const container = document.getElementById(`container-${position.row}-${position.col}`);
            console.log('Found container for cell:', container);
            if (container) {
                container.classList.add('other-user-active-cell');
                // Use a darker shade of the user's color for the active cell
                const darkShade = adjustColorBrightness(theme.light, -30);
                container.style.backgroundColor = darkShade;
                console.log('Added active cell highlighting with color:', darkShade);
            }
            
            // If this cell position also includes clue info, highlight the word
            if (position.activeClue) {
                console.log('Also highlighting word for clue:', position.activeClue);
                const wordStart = findWordStart(position.activeClue.number);
                if (wordStart) {
                    const wordCells = findWordCells(wordStart.row, wordStart.col, position.activeClue.direction);
                    console.log('Found word cells for highlighting:', wordCells.length);
                    
                    wordCells.forEach(cell => {
                        if (cell.container && cell.container !== container) {
                            cell.container.classList.add('other-user-word-highlight');
                            cell.container.style.backgroundColor = theme.light;
                        }
                    });
                }
            }
        } else if (position.type === 'clue') {
            // Show indicator on clue
            const clueItem = document.querySelector(`[data-direction="${position.direction}"][data-number="${position.number}"]`);
            console.log('Found clue item:', clueItem);
            if (clueItem) {
                clueItem.classList.add('other-user-clue');
                clueItem.style.borderLeftColor = theme.primary;
                
                // Add small colored dot indicator
                const indicator = document.createElement('div');
                indicator.className = 'other-user-indicator';
                indicator.style.cssText = `
                    position: absolute;
                    top: 8px;
                    right: 8px;
                    width: 8px;
                    height: 8px;
                    background-color: ${theme.primary};
                    border-radius: 50%;
                    z-index: 10;
                    pointer-events: none;
                `;
                clueItem.style.position = 'relative';
                clueItem.appendChild(indicator);
                console.log('Added clue indicator');
            }
            
            // Also highlight the word cells for this clue
            const wordStart = findWordStart(position.number);
            console.log('Finding word start for clue', position.number, ':', wordStart);
            if (wordStart) {
                const wordCells = findWordCells(wordStart.row, wordStart.col, position.direction);
                console.log('Found word cells:', wordCells.length);
                
                wordCells.forEach(cell => {
                    if (cell.container) {
                        cell.container.classList.add('other-user-word-highlight');
                        cell.container.style.backgroundColor = theme.light;
                    }
                });
                console.log('Added word cell highlighting');
            }
        }
    });
    
    console.log('=== VISUAL INDICATORS UPDATE COMPLETE ===');
}

// Manual cleanup function for debugging
function clearAllOtherUserHighlights() {
    console.log('=== MANUAL CLEANUP ===');
    
    // Clear all other-user classes and styles
    document.querySelectorAll('.other-user-indicator').forEach(el => {
        console.log('Removing indicator:', el);
        el.remove();
    });
    
    document.querySelectorAll('.cell-container').forEach(container => {
        if (container.classList.contains('other-user-active-cell') || 
            container.classList.contains('other-user-word-highlight')) {
            console.log('Cleaning container:', container.id);
            container.classList.remove('other-user-active-cell', 'other-user-word-highlight');
            container.style.removeProperty('background-color');
            container.style.removeProperty('border-color');
            container.style.removeProperty('border');
        }
    });
    
    document.querySelectorAll('.clue-item').forEach(item => {
        if (item.classList.contains('other-user-clue')) {
            console.log('Cleaning clue item:', item.dataset);
            item.classList.remove('other-user-clue');
            item.style.removeProperty('border-left-color');
        }
    });
    
    console.log('Manual cleanup complete');
}

// Expose cleanup function globally for debugging
window.clearAllOtherUserHighlights = clearAllOtherUserHighlights;

// Handle page unload to clean up presence
window.addEventListener('beforeunload', () => {
    console.log('Page unloading - sending disconnect signal');
    // Send disconnect signal (fire and forget)
    try {
        fetch('/api/disconnect', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Client-ID': clientId
            },
            body: JSON.stringify({ clientId: clientId }),
            keepalive: true
        }).catch(() => {
            // Ignore errors during disconnect
        });
    } catch (error) {
        console.log('Disconnect failed:', error);
    }
});

// Also handle page visibility changes
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        console.log('Tab hidden - sending disconnect signal');
        fetch('/api/disconnect', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Client-ID': clientId
            },
            body: JSON.stringify({ clientId: clientId })
        }).catch(() => {
            // Ignore errors during disconnect
        });
    }
});

// Create crossword grid
function createGrid() {
    gridElement.innerHTML = '';
    
    for (let row = 0; row < GRID_SIZE; row++) {
        for (let col = 0; col < GRID_SIZE; col++) {
            const cellContainer = document.createElement('div');
            cellContainer.className = 'cell-container';
            cellContainer.dataset.row = row;
            cellContainer.dataset.col = col;
            cellContainer.id = `container-${row}-${col}`;
            
            const cellNumber = document.createElement('span');
            cellNumber.className = 'cell-number';
            cellNumber.id = `number-${row}-${col}`;
            
            const cell = document.createElement('input');
            cell.className = 'grid-cell';
            cell.type = 'text';
            cell.maxLength = 2;
            cell.dataset.row = row;
            cell.dataset.col = col;
            cell.id = `cell-${row}-${col}`;
            
            // iOS optimization attributes
            cell.setAttribute('autocomplete', 'off');
            cell.setAttribute('autocorrect', 'off');
            cell.setAttribute('autocapitalize', 'off');
            cell.setAttribute('spellcheck', 'false');
            cell.setAttribute('inputmode', 'text');
            
            // Create an overlay div for click handling on black cells
            const clickOverlay = document.createElement('div');
            clickOverlay.className = 'click-overlay';
            clickOverlay.dataset.row = row;
            clickOverlay.dataset.col = col;
            clickOverlay.id = `overlay-${row}-${col}`;
            
            cellContainer.appendChild(cellNumber);
            cellContainer.appendChild(cell);
            cellContainer.appendChild(clickOverlay);
            
            // Add event listeners
            cell.addEventListener('input', handleCellInput);
            cell.addEventListener('focus', handleCellFocus);
            cell.addEventListener('click', handleCellTap);
            cell.addEventListener('keydown', handleKeyDown);
            cell.addEventListener('keyup', handleCellKeyUp);
            cell.addEventListener('touchend', handleCellTap); // iOS touch support
            cellContainer.addEventListener('contextmenu', handleRightClick);
            clickOverlay.addEventListener('click', handleCellClick);
            
            // Add brush mode event listeners
            cellContainer.addEventListener('mousedown', handleCellMouseDown);
            cellContainer.addEventListener('mouseover', handleCellMouseOver);
            cellContainer.addEventListener('mouseup', handleCellMouseUp);
            
            // Add touch event listeners for mobile support
            cellContainer.addEventListener('touchstart', handleCellTouchStart);
            cellContainer.addEventListener('touchmove', handleCellTouchMove);
            cellContainer.addEventListener('touchend', handleCellTouchEnd);
            
            gridElement.appendChild(cellContainer);
        }
    }
}

// Handle cell input (optimized for iOS)
function handleCellInput(e) {
    const cell = e.target;
    let value = cell.value;
    
    // Only allow letters and numbers
    value = value.replace(/[^A-Za-z0-9]/g, '');
    
    // In game mode, only allow single letters (immediate replacement)
    if (!isSetupMode) {
        if (value.length > 1 && /[A-Za-z]/.test(value)) {
            // Keep only the last letter typed
            const lastChar = value[value.length - 1];
            if (/[A-Za-z]/.test(lastChar)) {
                value = lastChar;
            } else {
                value = '';
            }
        } else if (value.length > 1) {
            value = value.slice(0, 1);
        }
        
        // For iOS, immediately process single letters to avoid input lag
        if (/^[A-Za-z]$/.test(value)) {
            const row = parseInt(cell.dataset.row);
            const col = parseInt(cell.dataset.col);
            // Use a small delay to ensure the input event completes
            setTimeout(() => {
                processCellInput(cell, row, col);
            }, 10);
        }
    } else {
        // Setup mode: max 2 characters for number+letter combinations
        if (value.length > 2) {
            value = value.slice(0, 2);
        }
    }
    
    cell.value = value;
}

// Handle key up - optimized for iOS virtual keyboard
function handleCellKeyUp(e) {
    const cell = e.target;
    const row = parseInt(cell.dataset.row);
    const col = parseInt(cell.dataset.col);
    const cellKey = `${row}-${col}`;
    const value = cell.value;
    
    // Clear any existing timeout for this cell
    if (inputTimeouts.has(cellKey)) {
        clearTimeout(inputTimeouts.get(cellKey));
    }
    
    // For iOS, process immediately for single letters to avoid input lag
    if (/^[A-Za-z]$/.test(value)) {
        console.log('Immediate letter processing:', value, 'Mode:', isSetupMode ? 'Setup' : 'Game');
        processCellInput(cell, row, col);
        return;
    }
    
    // For numbers and combinations, use shorter debounce delay for iOS
    const timeoutId = setTimeout(() => {
        processCellInput(cell, row, col);
        inputTimeouts.delete(cellKey);
    }, 200); // Reduced delay for better iOS responsiveness
    
    inputTimeouts.set(cellKey, timeoutId);
}

// Process the final cell input
function processCellInput(cell, row, col) {
    const value = cell.value;
    console.log('Processing final value:', value, 'Setup mode:', isSetupMode);
    
    if (isSetupMode) {
        // Setup mode: numbers add labels, letters toggle black cells
        
        // Check if input is just a number (1-2 digits)
        if (/^\d{1,2}$/.test(value)) {
            console.log('Processing number:', value);
            // Handle number input - add to cell number label
            const numberSpan = document.getElementById(`number-${row}-${col}`);
            numberSpan.textContent = value;
            cell.value = ''; // Clear the input field
            
            const cellData = {
                value: '',
                number: value,
                isBlack: false
            };
            
            sendToServer({
                type: 'grid-update',
                key: `${row}-${col}`,
                value: cellData
            });
            
            return;
        }
        
        // Check if input is just a single letter - toggle black cell
        if (/^[A-Za-z]$/.test(value)) {
            console.log('Setup mode: toggling black cell for letter input:', value);
            cell.value = ''; // Clear the input field
            
            const container = document.getElementById(`container-${row}-${col}`);
            const numberSpan = document.getElementById(`number-${row}-${col}`);
            const isBlack = container.classList.contains('black');
            
            const cellData = {
                value: '',
                number: isBlack ? numberSpan.textContent : '', // Keep number if toggling to white, clear if toggling to black
                isBlack: !isBlack
            };
            
            // Send to server
            sendToServer({
                type: 'grid-update',
                key: `${row}-${col}`,
                value: cellData
            });
            
            // Apply changes immediately for responsiveness
            if (cellData.isBlack) {
                container.classList.add('black');
                cell.disabled = true;
                cell.value = '';
                numberSpan.textContent = '';
            } else {
                container.classList.remove('black');
                cell.disabled = false;
                numberSpan.textContent = cellData.number;
            }
            
            return;
        }
        
        // Check if input starts with numbers followed by a letter - add number then toggle black
        const numberLetterMatch = value.match(/^(\d{1,2})([A-Za-z])$/);
        if (numberLetterMatch) {
            console.log('Setup mode: processing number+letter (add number, toggle black):', numberLetterMatch[1], numberLetterMatch[2]);
            const number = numberLetterMatch[1];
            
            // Set the number first
            const numberSpan = document.getElementById(`number-${row}-${col}`);
            numberSpan.textContent = number;
            
            // Clear the input field
            cell.value = '';
            
            // Then toggle to black
            const container = document.getElementById(`container-${row}-${col}`);
            
            const cellData = {
                value: '',
                number: '',
                isBlack: true
            };
            
            sendToServer({
                type: 'grid-update',
                key: `${row}-${col}`,
                value: cellData
            });
            
            // Apply changes immediately
            container.classList.add('black');
            cell.disabled = true;
            numberSpan.textContent = '';
            
            return;
        }
    } else {
        // Game mode: only allow single letters for answers
        if (/^[A-Za-z]$/.test(value)) {
            console.log('Game mode: processing letter:', value);
            const upperValue = value.toUpperCase();
            const oldValue = cell.value;
            cell.value = upperValue;
            
            const cellData = {
                value: upperValue,
                number: document.getElementById(`number-${row}-${col}`).textContent,
                isBlack: false
            };
            
            sendToServer({
                type: 'grid-update',
                key: `${row}-${col}`,
                value: cellData
            });
            
            // Only move to next cell if this was a new letter entry (not just processing existing value)
            if (oldValue !== upperValue) {
                moveToNextCell(row, col);
            }
            return;
        }
    }
    
    // If we have an invalid combination, clear it
    if (value.length > 0) {
        console.log('Clearing invalid input:', value);
        cell.value = '';
    }
}

// Handle cell focus
function handleCellFocus(e) {
    currentCell = e.target;
    
    const row = parseInt(e.target.dataset.row);
    const col = parseInt(e.target.dataset.col);
    
    // Send enhanced presence update that includes both clue and cell info
    const presenceData = { type: 'cell', row: row, col: col };
    
    // If we're actively working on a clue, include that info too
    if (currentClueDirection && currentClueNumber && activeWordCells.length > 0) {
        presenceData.activeClue = {
            direction: currentClueDirection,
            number: currentClueNumber
        };
        console.log('Sending combined presence: cell + clue', presenceData);
    }
    
    sendPresenceUpdate(presenceData);
    
    // Only implement reverse context-awareness if we're not currently editing a clue
    // AND if this focus wasn't triggered by our own focus management
    const isEditingClue = document.activeElement && 
          (document.activeElement.classList.contains('clue-input') || 
           document.activeElement.classList.contains('clue-number-input'));
    
    if (!isEditingClue) {
        // Implement reverse context-awareness: grid cell -> clue
        handleGridToClueContext(row, col, false);
    }
}

// Handle cell tap/click for double-tap detection
function handleCellTap(e) {
    // Skip if in setup mode (handled by other functions)
    if (isSetupMode) return;
    
    const row = parseInt(e.target.dataset.row);
    const col = parseInt(e.target.dataset.col);
    const cellKey = `${row}-${col}`;
    
    // Check for double-tap
    const currentTime = Date.now();
    const isDoubleTap = (lastFocusedCell === cellKey && 
                       currentTime - lastFocusTime < DOUBLE_TAP_DELAY);
    
    console.log(`Cell tap: ${cellKey}, last: ${lastFocusedCell}, time diff: ${currentTime - lastFocusTime}, double-tap: ${isDoubleTap}`);
    
    // Update tracking variables
    lastFocusedCell = cellKey;
    lastFocusTime = currentTime;
    
    // Handle context with double-tap detection
    handleGridToClueContext(row, col, isDoubleTap);
    
    // Focus the cell to ensure it becomes the current cell
    e.target.focus();
}

// Handle keyboard navigation
function handleKeyDown(e) {
    if (!currentCell) return;
    
    const row = parseInt(currentCell.dataset.row);
    const col = parseInt(currentCell.dataset.col);
    
    switch(e.key) {
        case 'ArrowUp':
            e.preventDefault();
            moveTo(row - 1, col);
            break;
        case 'ArrowDown':
            e.preventDefault();
            moveTo(row + 1, col);
            break;
        case 'ArrowLeft':
            e.preventDefault();
            moveTo(row, col - 1);
            break;
        case 'ArrowRight':
            e.preventDefault();
            moveTo(row, col + 1);
            break;
        case 'Backspace':
            e.preventDefault();
            
            // Clear the current cell if it has content
            if (currentCell.value && currentCell.value.trim() !== '') {
                currentCell.value = '';
                
                // Send the deletion to server
                const numberSpan = document.getElementById(`number-${row}-${col}`);
                const cellData = {
                    value: '',
                    number: numberSpan.textContent,
                    isBlack: false
                };
                
                sendToServer({
                    type: 'grid-update',
                    key: `${row}-${col}`,
                    value: cellData
                });
            }
            
            // Always move to previous cell after backspace
            moveToPreviousCell(row, col);
            break;
    }
}

// Handle left-click on black cells to toggle back to white (setup mode only)
function handleCellClick(e) {
    console.log('Overlay click detected, setup mode:', isSetupMode);
    
    // Only allow click toggle in setup mode
    if (!isSetupMode) {
        console.log('Not in setup mode, ignoring');
        return;
    }
    
    // Get the overlay that was clicked
    const overlay = e.target;
    const row = parseInt(overlay.dataset.row);
    const col = parseInt(overlay.dataset.col);
    
    console.log('Clicked overlay for cell:', row, col);
    
    const container = document.getElementById(`container-${row}-${col}`);
    const cell = document.getElementById(`cell-${row}-${col}`);
    const numberSpan = document.getElementById(`number-${row}-${col}`);
    
    const isBlack = container.classList.contains('black');
    console.log('Container is black:', isBlack);
    
    // Only toggle if the cell is currently black
    if (!isBlack) {
        console.log('Cell is not black, ignoring click');
        return;
    }
    
    console.log('Left-click: toggling black cell back to white');
    
    const cellData = {
        value: '',
        number: '',
        isBlack: false
    };
    
    // Send to server
    sendToServer({
        type: 'grid-update',
        key: `${row}-${col}`,
        value: cellData
    });
    
    // Apply changes immediately for responsiveness
    container.classList.remove('black');
    cell.disabled = false;
    
    // Focus the cell after a short delay to ensure it's enabled
    setTimeout(() => {
        cell.focus();
    }, 50);
}

// Handle right-click to toggle black cells (setup mode only)
function handleRightClick(e) {
    e.preventDefault();
    
    // Only allow right-click in setup mode
    if (!isSetupMode) {
        return;
    }
    
    const container = e.target.closest('.cell-container');
    if (!container) return;
    
    const row = parseInt(container.dataset.row);
    const col = parseInt(container.dataset.col);
    const cell = document.getElementById(`cell-${row}-${col}`);
    const numberSpan = document.getElementById(`number-${row}-${col}`);
    
    const isBlack = container.classList.contains('black');
    
    const cellData = {
        value: '',
        number: '',
        isBlack: !isBlack
    };
    
    // Send to server
    sendToServer({
        type: 'grid-update',
        key: `${row}-${col}`,
        value: cellData
    });
    
    // Apply changes immediately for responsiveness
    if (cellData.isBlack) {
        container.classList.add('black');
        cell.disabled = true;
        cell.value = '';
        numberSpan.textContent = '';
    } else {
        container.classList.remove('black');
        cell.disabled = false;
    }
}

// Brush mode event handlers
function handleCellMouseDown(e) {
    if (!isSetupMode || !isBrushMode) return;
    
    e.preventDefault();
    isMouseDown = true;
    
    const container = e.target.closest('.cell-container');
    if (!container) return;
    
    const isCurrentlyBlack = container.classList.contains('black');
    // Set paint mode based on current state - if black, we'll paint white; if white, we'll paint black
    brushPaintMode = isCurrentlyBlack ? 'white' : 'black';
    
    // Paint the clicked cell
    paintCell(container, brushPaintMode === 'black');
}

function handleCellMouseOver(e) {
    if (!isSetupMode || !isBrushMode || !isMouseDown) return;
    
    const container = e.target.closest('.cell-container');
    if (!container) return;
    
    // Paint the cell we're hovering over
    paintCell(container, brushPaintMode === 'black');
}

function handleCellMouseUp(e) {
    if (!isSetupMode || !isBrushMode) return;
    
    isMouseDown = false;
    brushPaintMode = null;
}

function paintCell(container, makeBlack) {
    const row = parseInt(container.dataset.row);
    const col = parseInt(container.dataset.col);
    const cell = document.getElementById(`cell-${row}-${col}`);
    const numberSpan = document.getElementById(`number-${row}-${col}`);
    
    const cellData = {
        value: '',
        number: '',
        isBlack: makeBlack
    };
    
    // Send to server
    sendToServer({
        type: 'grid-update',
        key: `${row}-${col}`,
        value: cellData
    });
    
    // Apply changes immediately for responsiveness
    if (cellData.isBlack) {
        container.classList.add('black');
        cell.disabled = true;
        cell.value = '';
        numberSpan.textContent = '';
    } else {
        container.classList.remove('black');
        cell.disabled = false;
    }
}

// Touch event handlers for mobile brush mode
function handleCellTouchStart(e) {
    if (!isSetupMode || !isBrushMode) return;
    
    e.preventDefault(); // Prevent scrolling and text selection
    isMouseDown = true;
    
    const container = e.target.closest('.cell-container');
    if (!container) return;
    
    const isCurrentlyBlack = container.classList.contains('black');
    brushPaintMode = isCurrentlyBlack ? 'white' : 'black';
    
    paintCell(container, brushPaintMode === 'black');
}

function handleCellTouchMove(e) {
    if (!isSetupMode || !isBrushMode || !isMouseDown) return;
    
    e.preventDefault(); // Prevent scrolling
    
    // Get the element under the touch point
    const touch = e.touches[0];
    const elementUnderTouch = document.elementFromPoint(touch.clientX, touch.clientY);
    const container = elementUnderTouch?.closest('.cell-container');
    
    if (!container) return;
    
    paintCell(container, brushPaintMode === 'black');
}

function handleCellTouchEnd(e) {
    if (!isSetupMode || !isBrushMode) return;
    
    e.preventDefault();
    isMouseDown = false;
    brushPaintMode = null;
}

// Move to specific cell
function moveTo(row, col) {
    if (row >= 0 && row < GRID_SIZE && col >= 0 && col < GRID_SIZE) {
        const container = document.getElementById(`container-${row}-${col}`);
        const cell = document.getElementById(`cell-${row}-${col}`);
        if (container && cell && !container.classList.contains('black')) {
            cell.focus();
        }
    }
}

// Move to next cell (direction-aware based on current highlighting)
function moveToNextCell(row, col) {
    // If we have an active word highlighted, move according to its direction
    if (currentClueDirection && activeWordCells.length > 0) {
        // Find current position in the active word
        const currentIndex = activeWordCells.findIndex(cell => 
            cell.row === row && cell.col === col
        );
        
        if (currentIndex !== -1 && currentIndex + 1 < activeWordCells.length) {
            // Move to next cell in the highlighted word
            const nextCell = activeWordCells[currentIndex + 1];
            moveTo(nextCell.row, nextCell.col);
            return;
        }
    }
    
    // Fallback to default behavior (right, then down) if no active word
    if (col + 1 < GRID_SIZE) {
        moveTo(row, col + 1);
    } else if (row + 1 < GRID_SIZE) {
        moveTo(row + 1, 0);
    }
}

// Move to previous cell (direction-aware based on current highlighting)
function moveToPreviousCell(row, col) {
    // If we have an active word highlighted, move according to its direction
    if (currentClueDirection && activeWordCells.length > 0) {
        // Find current position in the active word
        const currentIndex = activeWordCells.findIndex(cell => 
            cell.row === row && cell.col === col
        );
        
        if (currentIndex !== -1 && currentIndex - 1 >= 0) {
            // Move to previous cell in the highlighted word
            const prevCell = activeWordCells[currentIndex - 1];
            moveTo(prevCell.row, prevCell.col);
            return;
        }
    }
    
    // Fallback to default behavior (left, then up) if no active word
    if (col - 1 >= 0) {
        moveTo(row, col - 1);
    } else if (row - 1 >= 0) {
        moveTo(row - 1, GRID_SIZE - 1);
    }
}

// Create clue display for a direction
function updateCluesDisplay(direction, cluesData) {
    const cluesList = direction === 'across' ? acrossCluesList : downCluesList;
    cluesList.innerHTML = '';
    
    // Sort clues by number
    const sortedClues = Object.entries(cluesData).sort((a, b) => parseInt(a[0]) - parseInt(b[0]));
    
    sortedClues.forEach(([number, text]) => {
        addClueToDisplay(direction, number, text);
    });
}

// Add a single clue to the display
function addClueToDisplay(direction, number, text) {
    const cluesList = direction === 'across' ? acrossCluesList : downCluesList;
    
    const clueItem = document.createElement('div');
    clueItem.className = 'clue-item';
    clueItem.dataset.direction = direction;
    clueItem.dataset.number = number;
    
    clueItem.innerHTML = `
        <input type="number" class="clue-number-input" value="${number}" min="1" max="99" ${isSetupMode ? '' : 'readonly'}" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" inputmode="numeric">
        <textarea class="clue-input" placeholder="Enter clue..." ${isSetupMode ? '' : 'readonly'}" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">${text || ''}</textarea>
        <button class="delete-clue-btn" ${isSetupMode ? '' : 'disabled'} style="display: ${isSetupMode ? '' : 'none'}">×</button>
    `;
    
    // Add event listeners
    const numberInput = clueItem.querySelector('.clue-number-input');
    const clueInput = clueItem.querySelector('.clue-input');
    const deleteBtn = clueItem.querySelector('.delete-clue-btn');
    
    // Number input handler
    numberInput.addEventListener('input', (e) => {
        const newNumber = e.target.value;
        
        // Check if new number already exists (but allow it, just style it red)
        const existingClue = document.querySelector(`[data-direction="${direction}"][data-number="${newNumber}"]`);
        if (existingClue && existingClue !== clueItem) {
            // Style as error but don't prevent
            numberInput.classList.add('error');
        } else {
            numberInput.classList.remove('error');
        }
    });
    
    numberInput.addEventListener('change', (e) => {
        const newNumber = e.target.value;
        if (newNumber && newNumber !== number) {
            // Update the clue item's data attribute regardless of duplicates
            clueItem.dataset.number = newNumber;
            
            // Send update to server for both number change and existing text
            sendToServer({
                type: 'clue-delete',
                direction: direction,
                number: number
            });
            
            sendToServer({
                type: 'clue-update',
                direction: direction,
                number: newNumber,
                text: clueInput.value
            });
        }
    });
    
    // Clue input handlers
    clueInput.addEventListener('focus', () => {
        const currentNumber = numberInput.value;
        
        if (isSetupMode) {
            // In setup mode, just show the clue display, don't highlight grid or focus cells
            showActiveClue(direction, currentNumber);
        } else {
            // In game mode, highlight the word and focus first empty cell
            // Highlight immediately for better responsiveness
            highlightWord(direction, currentNumber);
        }
    });
    
    clueInput.addEventListener('blur', (e) => {
        // In setup mode, be more permissive about keeping focus on clues
        // In game mode, only clear if focus moves completely away from grid and clues
        setTimeout(() => {
            const activeElement = document.activeElement;
            
            if (isSetupMode) {
                // Setup mode: only clear if moving outside clue system
                const isStillInClues = activeElement && (
                    activeElement.classList.contains('clue-input') ||
                    activeElement.classList.contains('clue-number-input') ||
                    activeElement.closest('.clues-container')
                );
                
                if (!isStillInClues) {
                    clearWordHighlight();
                }
            } else {
                // Game mode: keep highlighting if moving to grid or staying in clues
                const isStillInClues = activeElement && (
                    activeElement.classList.contains('clue-input') ||
                    activeElement.classList.contains('clue-number-input') ||
                    activeElement.closest('.clues-container')
                );
                
                const isInGrid = activeElement && activeElement.classList.contains('grid-cell');
                
                if (!isStillInClues && !isInGrid) {
                    clearWordHighlight();
                }
            }
        }, 100);
    });
    
    clueInput.addEventListener('input', (e) => {
        // Auto-resize textarea to fit content
        autoResizeTextarea(e.target);
        
        // Update active clue display immediately
        if (activeClueText && currentClueDirection === direction && currentClueNumber == numberInput.value) {
            activeClueText.textContent = e.target.value || '(no clue entered)';
        }
        
        // Debounce clue updates to reduce server spam
        clearTimeout(clueInput.debounceTimeout);
        clueInput.debounceTimeout = setTimeout(() => {
            sendToServer({
                type: 'clue-update',
                direction: direction,
                number: numberInput.value,
                text: e.target.value
            });
        }, 300); // Wait 300ms after user stops typing
    });
    
    // Initial resize for existing content
    autoResizeTextarea(clueInput);
    
    // Length input doesn't need server sync - it's just a helper
    
    deleteBtn.addEventListener('click', () => {
        if (isSetupMode) {
            sendToServer({
                type: 'clue-delete',
                direction: direction,
                number: number
            });
            clueItem.remove();
        }
    });
    
    cluesList.appendChild(clueItem);
}

// Update a single clue
function updateSingleClue(direction, number, text) {
    const clueItem = document.querySelector(`[data-direction="${direction}"][data-number="${number}"]`);
    if (clueItem) {
        const input = clueItem.querySelector('.clue-input');
        // Only update if the input is not currently focused (to avoid overwriting while user types)
        if (input !== document.activeElement && input.value !== text) {
            input.value = text;
            // Auto-resize the textarea after updating content
            autoResizeTextarea(input);
        }
    } else {
        // Only add clue if text is not empty (avoid creating empty clues from server sync)
        if (text && text.trim() !== '') {
            addClueToDisplay(direction, number, text);
        }
    }
}

// Delete a single clue
function deleteSingleClue(direction, number) {
    const clueItem = document.querySelector(`[data-direction="${direction}"][data-number="${number}"]`);
    if (clueItem) {
        clueItem.remove();
    }
}

// Handle adding new clues
function handleAddClue(direction) {
    if (!isSetupMode) return;
    
    // Find the next available number
    const existingNumbers = Array.from(document.querySelectorAll(`[data-direction="${direction}"]`))
        .map(el => parseInt(el.dataset.number))
        .filter(num => !isNaN(num));
    
    const nextNumber = existingNumbers.length === 0 ? 1 : Math.max(...existingNumbers) + 1;
    
    addClueToDisplay(direction, nextNumber.toString(), '');
    
    // Focus the number input first so user can edit it if needed
    setTimeout(() => {
        const newClueItem = document.querySelector(`[data-direction="${direction}"][data-number="${nextNumber}"]`);
        if (newClueItem) {
            const numberInput = newClueItem.querySelector('.clue-number-input');
            if (numberInput) {
                numberInput.select(); // Select the number so they can replace it easily
            }
        }
    }, 100);
}

// Notice modal system
function showNotice(title, message, options = {}) {
    const modal = document.getElementById('notice-modal');
    const titleEl = document.getElementById('notice-title');
    const messageEl = document.getElementById('notice-message');
    const confirmBtn = document.getElementById('notice-confirm-btn');
    const cancelBtn = document.getElementById('notice-cancel-btn');
    
    titleEl.textContent = title;
    messageEl.textContent = message;
    
    // Configure buttons
    confirmBtn.textContent = options.confirmText || 'OK';
    confirmBtn.className = 'notice-confirm-button' + (options.confirmType ? ` ${options.confirmType}` : '');
    
    if (options.showCancel) {
        cancelBtn.style.display = 'block';
        cancelBtn.textContent = options.cancelText || 'Cancel';
    } else {
        cancelBtn.style.display = 'none';
    }
    
    // Show modal
    modal.style.display = 'flex';
    
    // Return a promise that resolves when user makes a choice
    return new Promise((resolve) => {
        const handleConfirm = () => {
            modal.style.display = 'none';
            cleanup();
            resolve(true);
        };
        
        const handleCancel = () => {
            modal.style.display = 'none';
            cleanup();
            resolve(false);
        };
        
        const handleEscape = (e) => {
            if (e.key === 'Escape' && modal.style.display === 'flex') {
                handleCancel();
            }
        };
        
        const cleanup = () => {
            confirmBtn.removeEventListener('click', handleConfirm);
            cancelBtn.removeEventListener('click', handleCancel);
            document.getElementById('close-notice-btn').removeEventListener('click', handleCancel);
            document.getElementById('notice-backdrop').removeEventListener('click', handleCancel);
            document.removeEventListener('keydown', handleEscape);
        };
        
        // Add event listeners
        confirmBtn.addEventListener('click', handleConfirm);
        cancelBtn.addEventListener('click', handleCancel);
        document.getElementById('close-notice-btn').addEventListener('click', handleCancel);
        document.getElementById('notice-backdrop').addEventListener('click', handleCancel);
        document.addEventListener('keydown', handleEscape);
    });
}

// Handle New Game button
async function handleNewGame() {
    const confirmed = await showNotice(
        'New Game',
        'Are you sure you want to start a new game? This will clear the entire grid and all clues for everyone!',
        {
            showCancel: true,
            confirmText: 'Clear Game',
            confirmType: 'danger',
            cancelText: 'Cancel'
        }
    );
    
    if (confirmed) {
        // Send clear command to server
        sendToServer({
            type: 'clear-all'
        });
        
        // Clear local state immediately
        clearLocalGrid();
    }
}

// Clear the local grid and clues
function clearLocalGrid() {
    // Clear any active highlighting and clue display
    clearWordHighlight();
    
    // Clear all grid cells
    for (let row = 0; row < GRID_SIZE; row++) {
        for (let col = 0; col < GRID_SIZE; col++) {
            const container = document.getElementById(`container-${row}-${col}`);
            const cell = document.getElementById(`cell-${row}-${col}`);
            const numberSpan = document.getElementById(`number-${row}-${col}`);
            
            if (container && cell && numberSpan) {
                container.classList.remove('black');
                container.classList.remove('word-highlight');
                cell.disabled = false;
                cell.value = '';
                numberSpan.textContent = '';
            }
        }
    }
    
    // Clear clues
    acrossCluesList.innerHTML = '';
    downCluesList.innerHTML = '';
}

// Switch to setup mode
function switchToSetupMode() {
    isSetupMode = true;
    
    // Update button states
    document.getElementById('setup-mode-btn').classList.add('active');
    document.getElementById('game-mode-btn').classList.remove('active');
    
    // Show setup tools
    document.getElementById('setup-tools').style.display = 'block';
    
    // Enable clue editing and buttons
    updateClueInputsMode(false);
    updateClueButtons(false);
    
    console.log('Switched to Setup Mode');
}

// Switch to game mode
function switchToGameMode() {
    isSetupMode = false;
    isBrushMode = false; // Reset brush mode when leaving setup
    
    // Update button states
    document.getElementById('setup-mode-btn').classList.remove('active');
    document.getElementById('game-mode-btn').classList.add('active');
    
    // Hide setup tools and reset brush button
    document.getElementById('setup-tools').style.display = 'none';
    document.getElementById('clue-import-modal').style.display = 'none';
    const brushBtn = document.getElementById('brush-mode-btn');
    const gridElement = document.getElementById('crossword-grid');
    brushBtn.classList.remove('active');
    brushBtn.textContent = '⬛ Brush Mode';
    gridElement.classList.remove('brush-mode');
    
    // Disable clue editing and buttons
    updateClueInputsMode(true);
    updateClueButtons(true);
    
    console.log('Switched to Game Mode');
}

// Toggle brush mode
function toggleBrushMode() {
    if (!isSetupMode) return;
    
    isBrushMode = !isBrushMode;
    const brushBtn = document.getElementById('brush-mode-btn');
    const gridElement = document.getElementById('crossword-grid');
    
    if (isBrushMode) {
        brushBtn.classList.add('active');
        brushBtn.textContent = '⬛ Brush ON';
        gridElement.classList.add('brush-mode');
        console.log('Brush mode enabled');
    } else {
        brushBtn.classList.remove('active');
        brushBtn.textContent = '⬛ Brush Mode';
        gridElement.classList.remove('brush-mode');
        console.log('Brush mode disabled');
    }
}

// Grid analysis and clue generation functions
function analyzeGrid() {
    const words = [];
    const gridData = getCurrentGridData();
    
    // Find horizontal words (across)
    for (let row = 0; row < GRID_SIZE; row++) {
        let currentWord = null;
        
        for (let col = 0; col < GRID_SIZE; col++) {
            const cellKey = `${row}-${col}`;
            const cellData = gridData[cellKey];
            const isBlack = cellData && cellData.isBlack;
            
            if (!isBlack) {
                // White cell - continue or start word
                if (!currentWord) {
                    currentWord = {
                        direction: 'across',
                        startRow: row,
                        startCol: col,
                        length: 1,
                        cells: [{row, col}]
                    };
                } else {
                    currentWord.length++;
                    currentWord.cells.push({row, col});
                }
            } else {
                // Black cell - end current word if it exists and is long enough
                if (currentWord && currentWord.length >= 2) {
                    words.push(currentWord);
                }
                currentWord = null;
            }
        }
        
        // End of row - check if we have a word
        if (currentWord && currentWord.length >= 2) {
            words.push(currentWord);
        }
    }
    
    // Find vertical words (down)
    for (let col = 0; col < GRID_SIZE; col++) {
        let currentWord = null;
        
        for (let row = 0; row < GRID_SIZE; row++) {
            const cellKey = `${row}-${col}`;
            const cellData = gridData[cellKey];
            const isBlack = cellData && cellData.isBlack;
            
            if (!isBlack) {
                // White cell - continue or start word
                if (!currentWord) {
                    currentWord = {
                        direction: 'down',
                        startRow: row,
                        startCol: col,
                        length: 1,
                        cells: [{row, col}]
                    };
                } else {
                    currentWord.length++;
                    currentWord.cells.push({row, col});
                }
            } else {
                // Black cell - end current word if it exists and is long enough
                if (currentWord && currentWord.length >= 2) {
                    words.push(currentWord);
                }
                currentWord = null;
            }
        }
        
        // End of column - check if we have a word
        if (currentWord && currentWord.length >= 2) {
            words.push(currentWord);
        }
    }
    
    return words;
}

function getCurrentGridData() {
    const gridData = {};
    
    for (let row = 0; row < GRID_SIZE; row++) {
        for (let col = 0; col < GRID_SIZE; col++) {
            const container = document.getElementById(`container-${row}-${col}`);
            const cell = document.getElementById(`cell-${row}-${col}`);
            const numberSpan = document.getElementById(`number-${row}-${col}`);
            
            if (container && cell && numberSpan) {
                gridData[`${row}-${col}`] = {
                    value: cell.value || '',
                    number: numberSpan.textContent || '',
                    isBlack: container.classList.contains('black')
                };
            }
        }
    }
    
    return gridData;
}

function assignClueNumbers(words) {
    // Sort words by starting position (top to bottom, left to right)
    const sortedWords = words.sort((a, b) => {
        if (a.startRow !== b.startRow) {
            return a.startRow - b.startRow;
        }
        return a.startCol - b.startCol;
    });
    
    const numberedCells = new Set();
    const clueNumbers = {};
    let currentNumber = 1;
    
    sortedWords.forEach(word => {
        const cellKey = `${word.startRow}-${word.startCol}`;
        
        if (!numberedCells.has(cellKey)) {
            // This cell needs a number
            word.number = currentNumber;
            clueNumbers[cellKey] = currentNumber;
            numberedCells.add(cellKey);
            currentNumber++;
        } else {
            // Cell already has a number from another word
            word.number = clueNumbers[cellKey];
        }
    });
    
    return { words: sortedWords, clueNumbers };
}

async function generateClues() {
    if (!isSetupMode) return;
    
    console.log('Analyzing grid for clue generation...');
    
    // Analyze grid to find words
    const words = analyzeGrid();
    console.log('Found words:', words);
    
    if (words.length === 0) {
        await showNotice(
            'No Valid Words',
            'No valid words found in the grid. Please add some white squares to create word patterns.',
            {
                confirmText: 'OK'
            }
        );
        return;
    }
    
    // Assign numbers to words
    const { words: numberedWords, clueNumbers } = assignClueNumbers(words);
    console.log('Numbered words:', numberedWords);
    console.log('Clue numbers:', clueNumbers);
    
    // Update grid with numbers
    updateGridWithNumbers(clueNumbers);
    
    // Generate clue templates
    generateClueTemplates(numberedWords);
    
    console.log('Clue generation complete!');
}

function updateGridWithNumbers(clueNumbers) {
    // Clear all existing numbers first
    for (let row = 0; row < GRID_SIZE; row++) {
        for (let col = 0; col < GRID_SIZE; col++) {
            const numberSpan = document.getElementById(`number-${row}-${col}`);
            if (numberSpan) {
                numberSpan.textContent = '';
            }
        }
    }
    
    // Add new numbers
    Object.entries(clueNumbers).forEach(([cellKey, number]) => {
        const [row, col] = cellKey.split('-').map(Number);
        const numberSpan = document.getElementById(`number-${row}-${col}`);
        if (numberSpan) {
            numberSpan.textContent = number;
        }
        
        // Send update to server
        const container = document.getElementById(`container-${row}-${col}`);
        const cell = document.getElementById(`cell-${row}-${col}`);
        if (container && cell) {
            const cellData = {
                value: cell.value || '',
                number: number.toString(),
                isBlack: container.classList.contains('black')
            };
            
            sendToServer({
                type: 'grid-update',
                key: cellKey,
                value: cellData
            });
        }
    });
}

function generateClueTemplates(words) {
    const acrossClues = {};
    const downClues = {};
    
    words.forEach(word => {
        const clueText = '';  // Empty clue text for manual entry
        
        if (word.direction === 'across') {
            acrossClues[word.number] = clueText;
        } else {
            downClues[word.number] = clueText;
        }
    });
    
    // Send clues to server
    sendToServer({
        type: 'clues-update',
        across: acrossClues,
        down: downClues
    });
    
    // Update UI
    updateCluesDisplay('across', acrossClues);
    updateCluesDisplay('down', downClues);
}

// Clue import functionality
function showClueImportPanel() {
    if (!isSetupMode) return;
    
    const modal = document.getElementById('clue-import-modal');
    modal.style.display = 'flex';
    
    // Focus the textarea
    const textarea = document.getElementById('clue-import-text');
    setTimeout(() => textarea.focus(), 100);
}

function hideClueImportPanel() {
    const modal = document.getElementById('clue-import-modal');
    modal.style.display = 'none';
}

function clearImportText() {
    const textarea = document.getElementById('clue-import-text');
    textarea.value = '';
    textarea.focus();
}

async function parseAndImportClues() {
    const textarea = document.getElementById('clue-import-text');
    const text = textarea.value.trim();
    
    if (!text) {
        await showNotice(
            'No Content',
            'Please paste some clues to import.',
            {
                confirmText: 'OK'
            }
        );
        return;
    }
    
    try {
        const parsedClues = parseClueText(text);
        
        if (parsedClues.across.length === 0 && parsedClues.down.length === 0) {
            await showNotice(
                'No Valid Clues Found',
                'No valid clues found. Please check the format:\n\n1. Clue text (5)\n2. Another clue (8,3)',
                {
                    confirmText: 'OK'
                }
            );
            return;
        }
        
        // Convert to the format expected by the system
        const acrossClues = {};
        const downClues = {};
        
        parsedClues.across.forEach(clue => {
            acrossClues[clue.number] = `${clue.text} (${clue.length})`;
        });
        
        parsedClues.down.forEach(clue => {
            downClues[clue.number] = `${clue.text} (${clue.length})`;
        });
        
        // Send to server
        sendToServer({
            type: 'clues-update',
            across: acrossClues,
            down: downClues
        });
        
        // Update UI
        updateCluesDisplay('across', acrossClues);
        updateCluesDisplay('down', downClues);
        
        // Hide panel and show success message
        hideClueImportPanel();
        
        const importedCount = parsedClues.across.length + parsedClues.down.length;
        await showNotice(
            'Import Successful',
            `Successfully imported ${importedCount} clues!`,
            {
                confirmText: 'OK',
                confirmType: 'success'
            }
        );
        
        console.log('Imported clues:', { across: acrossClues, down: downClues });
        console.log('Parsed clues before conversion:', parsedClues);
        
    } catch (error) {
        console.error('Error parsing clues:', error);
        await showNotice(
            'Parsing Error',
            'Error parsing clues. Please check the format and try again.\n\nExpected format:\nACROSS\n1. Clue text (5)\n3. Another clue (8)\n\nDOWN\n1. Down clue (7)\n2. Second clue (4)',
            {
                confirmText: 'OK'
            }
        );
    }
}

function parseClueText(text) {
    const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    const result = { across: [], down: [] };
    let currentSection = null;
    
    console.log('Parsing clue text, lines:', lines);
    
    lines.forEach(line => {
        console.log('Processing line:', line);
        
        // Check for section headers
        const upperLine = line.toUpperCase();
        if (upperLine === 'ACROSS' || upperLine === 'ACROSS:') {
            currentSection = 'across';
            console.log('Found ACROSS section');
            return;
        }
        if (upperLine === 'DOWN' || upperLine === 'DOWN:') {
            currentSection = 'down';
            console.log('Found DOWN section');
            return;
        }
        
        // Try to parse as a clue - more robust regex
        // Matches: "number. clue text (length)" where length can be like "5", "8,3", "6-5", "6/2/4" etc.
        const clueRegex = /^(\d+)\.\s*(.+)\s+\(([0-9,\s\-/]+)\)\s*$/;
        const match = line.match(clueRegex);
        
        if (match && currentSection) {
            const [, number, clueText, length] = match;
            const clue = {
                number: parseInt(number),
                text: clueText.trim(),
                length: length.trim()
            };
            result[currentSection].push(clue);
            console.log('Parsed clue:', clue);
            console.log('  - Original line:', line);
            console.log('  - Extracted text:', `"${clueText.trim()}"`);
            console.log('  - Extracted length:', `"${length.trim()}"`)
        } else if (currentSection) {
            console.log('Failed to parse clue line:', line);
            
            // Try alternative parsing for edge cases
            const altRegex = /^(\d+)\.\s*(.+)$/;
            const altMatch = line.match(altRegex);
            if (altMatch) {
                const [, number, rest] = altMatch;
                // Look for parentheses at the end
                const lengthMatch = rest.match(/^(.+?)\s*\(([0-9,\s\-/]+)\)\s*$/);
                if (lengthMatch) {
                    const [, clueText, length] = lengthMatch;
                    const clue = {
                        number: parseInt(number),
                        text: clueText.trim(),
                        length: length.trim()
                    };
                    result[currentSection].push(clue);
                    console.log('Parsed clue (alternative):', clue);
                }
            }
        }
    });
    
    console.log('Final parsed result:', result);
    return result;
}

// Update clue inputs based on mode
function updateClueInputsMode(readonly) {
    const clueInputs = document.querySelectorAll('.clue-input');
    const numberInputs = document.querySelectorAll('.clue-number-input');
    
    clueInputs.forEach(input => {
        input.readOnly = readonly;
    });
    
    numberInputs.forEach(input => {
        input.readOnly = readonly;
    });
}

// Update clue buttons based on mode
function updateClueButtons(disabled) {
    const addBtns = document.querySelectorAll('.add-clue-btn');
    const deleteBtns = document.querySelectorAll('.delete-clue-btn');
    
    addBtns.forEach(btn => {
        if (disabled) {
            btn.style.display = 'none';
        } else {
            btn.style.display = '';
            btn.disabled = false;
        }
    });
    
    deleteBtns.forEach(btn => {
        if (disabled) {
            btn.style.display = 'none';
        } else {
            btn.style.display = '';
            btn.disabled = false;
        }
    });
}

// Find all cells that belong to a word starting at given position
function findWordCells(startRow, startCol, direction) {
    const cells = [];
    let row = startRow;
    let col = startCol;
    
    while (row >= 0 && row < GRID_SIZE && col >= 0 && col < GRID_SIZE) {
        const container = document.getElementById(`container-${row}-${col}`);
        if (!container || container.classList.contains('black')) {
            break;
        }
        
        cells.push({row, col, container});
        
        if (direction === 'across') {
            col++;
        } else {
            row++;
        }
    }
    
    return cells.length > 1 ? cells : []; // Only return if it's actually a word (>1 cell)
}

// Find the starting position of a word with given number
function findWordStart(number) {
    for (let row = 0; row < GRID_SIZE; row++) {
        for (let col = 0; col < GRID_SIZE; col++) {
            const numberSpan = document.getElementById(`number-${row}-${col}`);
            if (numberSpan && numberSpan.textContent === number.toString()) {
                return {row, col};
            }
        }
    }
    return null;
}

// Highlight word cells
function highlightWord(direction, number) {
    // Clear previous highlighting
    clearWordHighlight();
    
    const wordStart = findWordStart(number);
    if (!wordStart) return;
    
    const wordCells = findWordCells(wordStart.row, wordStart.col, direction);
    if (wordCells.length === 0) return;
    
    // Store active word info
    activeWordCells = wordCells;
    currentClueDirection = direction;
    currentClueNumber = number;
    clueTypingPosition = 0;
    
    // Highlight all cells in the word
    wordCells.forEach(cell => {
        cell.container.classList.add('word-highlight');
    });
    
    // Send presence update for word highlighting
    sendPresenceUpdate({ type: 'clue', direction: direction, number: number });
    
    // Show the active clue below the grid
    showActiveClue(direction, number);
    
    // In game mode, focus the first empty cell for answering
    if (!isSetupMode) {
        focusFirstEmptyCell(wordCells);
    }
    
    console.log(`Highlighted ${direction} word ${number}:`, wordCells.length, 'cells');
}

// Focus the first empty cell in a word
function focusFirstEmptyCell(wordCells) {
    // Add a small delay to allow manual cell clicks to take precedence
    setTimeout(() => {
        // Only auto-focus if no grid cell is currently focused
        const currentFocus = document.activeElement;
        const isGridCellFocused = currentFocus && currentFocus.classList.contains('grid-cell');
        
        if (isGridCellFocused) {
            // User manually selected a cell, don't override their choice
            return;
        }
        
        for (const cellInfo of wordCells) {
            const cell = document.getElementById(`cell-${cellInfo.row}-${cellInfo.col}`);
            if (cell && (!cell.value || cell.value.trim() === '')) {
                cell.focus();
                return;
            }
        }
        
        // If no empty cells, focus the first cell
        if (wordCells.length > 0) {
            const firstCell = document.getElementById(`cell-${wordCells[0].row}-${wordCells[0].col}`);
            if (firstCell) {
                firstCell.focus();
            }
        }
    }, 100);
}

// Clear word highlighting
function clearWordHighlight() {
    document.querySelectorAll('.word-highlight').forEach(container => {
        container.classList.remove('word-highlight');
    });
    document.querySelectorAll('.clue-item.highlighted').forEach(item => {
        item.classList.remove('highlighted');
    });
    activeWordCells = [];
    currentClueDirection = null;
    currentClueNumber = null;
    clueTypingPosition = 0;
    
    // Hide the active clue display
    if (activeClueDisplay) {
        activeClueDisplay.style.display = 'none';
    }
}

// Show active clue below grid
function showActiveClue(direction, number) {
    if (!activeClueDisplay) return;
    
    // Clear previous clue highlighting
    document.querySelectorAll('.clue-item.highlighted').forEach(item => {
        item.classList.remove('highlighted');
    });
    
    // Find the clue text and highlight it
    const clueItem = document.querySelector(`[data-direction="${direction}"][data-number="${number}"]`);
    let clueText = '';
    
    if (clueItem) {
        const clueInput = clueItem.querySelector('.clue-input');
        clueText = clueInput ? clueInput.value : '';
        // Highlight the clue item
        clueItem.classList.add('highlighted');
    }
    
    // Update the display
    activeClueNumber.textContent = `${number} ${direction.toUpperCase()}`;
    activeClueText.textContent = clueText || '(no clue entered)';
    activeClueDisplay.style.display = 'block';
    
    // Scroll to ensure visibility
    activeClueDisplay.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// Handle grid cell focus to show corresponding clue (reverse context-awareness)
function handleGridToClueContext(row, col, isDoubleTap = false) {
    // In setup mode, don't be as aggressive with grid-to-clue context
    if (isSetupMode) {
        return; // Let setup mode focus on clue editing
    }
    
    console.log(`handleGridToClueContext: ${row},${col}, double-tap: ${isDoubleTap}, current: ${currentClueDirection} ${currentClueNumber}`);
    
    // Find the across and down clues that intersect at this cell
    let acrossClueNumber = null;
    let downClueNumber = null;
    
    // Find across clue (go left to find start)
    for (let c = col; c >= 0; c--) {
        const container = document.getElementById(`container-${row}-${c}`);
        if (!container || container.classList.contains('black')) break;
        
        const numSpan = document.getElementById(`number-${row}-${c}`);
        if (numSpan && numSpan.textContent) {
            // Check if this number has an across clue
            const acrossClue = document.querySelector(`[data-direction="across"][data-number="${numSpan.textContent}"]`);
            if (acrossClue) {
                acrossClueNumber = numSpan.textContent;
                break;
            }
        }
    }
    
    // Find down clue (go up to find start)
    for (let r = row; r >= 0; r--) {
        const container = document.getElementById(`container-${r}-${col}`);
        if (!container || container.classList.contains('black')) break;
        
        const numSpan = document.getElementById(`number-${r}-${col}`);
        if (numSpan && numSpan.textContent) {
            // Check if this number has a down clue
            const downClue = document.querySelector(`[data-direction="down"][data-number="${numSpan.textContent}"]`);
            if (downClue) {
                downClueNumber = numSpan.textContent;
                break;
            }
        }
    }
    
    console.log(`Found intersecting clues: ${acrossClueNumber} across, ${downClueNumber} down`);
    
    // Handle double-tap switching between intersecting clues
    if (isDoubleTap && acrossClueNumber && downClueNumber) {
        // Switch to the opposite direction from current
        if (currentClueDirection === 'across' && currentClueNumber === acrossClueNumber) {
            console.log(`Double-tap: switching from ${acrossClueNumber} across to ${downClueNumber} down`);
            highlightWord('down', downClueNumber);
            // Reset double-tap detection with a future timestamp to prevent immediate re-triggering
            lastFocusTime = Date.now() + DOUBLE_TAP_DELAY;
        } else if (currentClueDirection === 'down' && currentClueNumber === downClueNumber) {
            console.log(`Double-tap: switching from ${downClueNumber} down to ${acrossClueNumber} across`);
            highlightWord('across', acrossClueNumber);
            // Reset double-tap detection with a future timestamp to prevent immediate re-triggering
            lastFocusTime = Date.now() + DOUBLE_TAP_DELAY;
        } else {
            // Default to across on first tap
            console.log(`Double-tap: defaulting to ${acrossClueNumber} across`);
            highlightWord('across', acrossClueNumber);
        }
    } else {
        // Single click - check if we're already highlighting one of the intersecting clues
        const alreadyHighlighting = (
            (currentClueDirection === 'across' && currentClueNumber === acrossClueNumber) ||
            (currentClueDirection === 'down' && currentClueNumber === downClueNumber)
        );
        
        if (!alreadyHighlighting) {
            // Not currently highlighting either intersecting clue - default to across if available
            if (acrossClueNumber) {
                highlightWord('across', acrossClueNumber);
            } else if (downClueNumber) {
                highlightWord('down', downClueNumber);
            }
        }
        // If we're already highlighting one of the intersecting clues, don't change anything
    }
}

// Handle typing in clue input to fill grid
function handleClueTyping(character) {
    if (!activeWordCells.length || clueTypingPosition >= activeWordCells.length) {
        return;
    }
    
    const cellInfo = activeWordCells[clueTypingPosition];
    const cell = document.getElementById(`cell-${cellInfo.row}-${cellInfo.col}`);
    
    if (cell && /[A-Za-z]/.test(character)) {
        const upperChar = character.toUpperCase();
        cell.value = upperChar;
        
        // Send to server
        const numberSpan = document.getElementById(`number-${cellInfo.row}-${cellInfo.col}`);
        const cellData = {
            value: upperChar,
            number: numberSpan.textContent,
            isBlack: false
        };
        
        sendToServer({
            type: 'grid-update',
            key: `${cellInfo.row}-${cellInfo.col}`,
            value: cellData
        });
        
        clueTypingPosition++;
        console.log(`Filled cell ${cellInfo.row},${cellInfo.col} with '${upperChar}', position now ${clueTypingPosition}`);
    }
}

// Initialize the grid when page loads
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM loaded, getting elements...');
    
    // Get DOM elements
    gridElement = document.getElementById('crossword-grid');
    acrossCluesList = document.getElementById('across-clues-list');
    downCluesList = document.getElementById('down-clues-list');
    connectionDot = document.getElementById('connection-dot');
    clientCountElement = document.getElementById('client-count');
    activeClueDisplay = document.getElementById('active-clue-display');
    activeClueNumber = document.getElementById('active-clue-number');
    activeClueText = document.getElementById('active-clue-text');
    
    console.log('Creating grid...');
    createGrid();
    
    // Add event listeners for add clue buttons
    document.querySelectorAll('.add-clue-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const direction = e.target.dataset.direction;
            handleAddClue(direction);
        });
    });
    
    // Add New Game button listener
    const newGameBtn = document.getElementById('new-game-btn');
    newGameBtn.addEventListener('click', handleNewGame);
    
    // Add mode toggle listeners
    const setupModeBtn = document.getElementById('setup-mode-btn');
    const gameModeBtn = document.getElementById('game-mode-btn');
    setupModeBtn.addEventListener('click', switchToSetupMode);
    gameModeBtn.addEventListener('click', switchToGameMode);
    
    // Add brush mode toggle listener
    const brushModeBtn = document.getElementById('brush-mode-btn');
    brushModeBtn.addEventListener('click', toggleBrushMode);
    
    // Add color selection listeners
    document.querySelectorAll('.color-option').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const color = e.target.dataset.color;
            selectUserColor(color);
        });
    });
    
    // Initialize color selection
    initializeColorSelection();
    
    // Add generate clues button listener
    const generateCluesBtn = document.getElementById('generate-clues-btn');
    generateCluesBtn.addEventListener('click', generateClues);
    
    // Add clue import listeners
    const importCluesBtn = document.getElementById('import-clues-btn');
    const closeImportBtn = document.getElementById('close-import-btn');
    const parseCluesBtn = document.getElementById('parse-clues-btn');
    const clearImportBtn = document.getElementById('clear-import-btn');
    const modalBackdrop = document.getElementById('modal-backdrop');
    
    importCluesBtn.addEventListener('click', showClueImportPanel);
    closeImportBtn.addEventListener('click', hideClueImportPanel);
    parseCluesBtn.addEventListener('click', parseAndImportClues);
    clearImportBtn.addEventListener('click', clearImportText);
    
    // Click outside to close modal
    modalBackdrop.addEventListener('click', hideClueImportPanel);
    
    // Escape key to close modal
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const modal = document.getElementById('clue-import-modal');
            if (modal.style.display === 'flex') {
                hideClueImportPanel();
            }
        }
    });
    
    // Add global mouse event listeners for brush dragging
    document.addEventListener('mouseup', () => {
        if (isBrushMode) {
            isMouseDown = false;
            brushPaintMode = null;
        }
    });
    
    // Add global touch event listeners for brush dragging
    document.addEventListener('touchend', () => {
        if (isBrushMode) {
            isMouseDown = false;
            brushPaintMode = null;
        }
    });
    
    // Initialize with game mode (default)
    updateClueInputsMode(true); // readonly for game mode
    updateClueButtons(true); // disabled for game mode
    
    // Initialize HTTP polling
    initializePolling();
    
    // Set initial focus to first cell
    setTimeout(() => {
        const firstCell = document.getElementById('cell-0-0');
        if (firstCell) {
            firstCell.focus();
        }
    }, 100);
});