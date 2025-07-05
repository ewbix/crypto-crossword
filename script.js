// Crossword grid setup
const GRID_SIZE = 15;
let currentCell = null;
let lastUpdateId = 0;
let inputTimeouts = new Map(); // Store timeouts for each cell
let isSetupMode = false; // Track current mode - default to game mode

// DOM elements - will be initialized when DOM is ready
let gridElement, acrossCluesList, downCluesList, connectionDot, clientCountElement;
let activeClueDisplay, activeClueNumber, activeClueText;

// Client tracking - use localStorage to persist across page reloads
let clientId = localStorage.getItem('clientId');
if (!clientId) {
    clientId = `client-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    localStorage.setItem('clientId', clientId);
}

// Context-aware clue editing
let activeWordCells = [];
let currentClueDirection = null;
let currentClueNumber = null;
let clueTypingPosition = 0;

// Double-tap detection for switching between across/down
let lastFocusedCell = null;
let lastFocusTime = 0;
const DOUBLE_TAP_DELAY = 500; // milliseconds

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
            if (update.type === 'client-count') {
                clientCountElement.textContent = update.clientCount;
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
                if (update.type === 'client-count') {
                    clientCountElement.textContent = update.clientCount;
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
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });
    } catch (error) {
        console.error('Failed to send update:', error);
    }
}

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
            cellContainer.addEventListener('contextmenu', handleRightClick);
            clickOverlay.addEventListener('click', handleCellClick);
            
            gridElement.appendChild(cellContainer);
        }
    }
}

// Handle cell input (simplified - just prevent invalid characters)
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
    } else {
        // Setup mode: max 2 characters for number+letter combinations
        if (value.length > 2) {
            value = value.slice(0, 2);
        }
    }
    
    cell.value = value;
}

// Handle key up - this is where we process the complete input with debounce
function handleCellKeyUp(e) {
    const cell = e.target;
    const row = parseInt(cell.dataset.row);
    const col = parseInt(cell.dataset.col);
    const cellKey = `${row}-${col}`;
    const value = cell.value;
    
    // Only process if this is from actual typing (not from focus/programmatic changes)
    if (e.key === undefined && e.code === undefined) {
        console.log('Ignoring programmatic input event');
        return;
    }
    
    // Clear any existing timeout for this cell
    if (inputTimeouts.has(cellKey)) {
        clearTimeout(inputTimeouts.get(cellKey));
    }
    
    // If it's just a single letter, process immediately (no delay) in both modes
    if (/^[A-Za-z]$/.test(value)) {
        console.log('Immediate letter processing:', value, 'Mode:', isSetupMode ? 'Setup' : 'Game');
        processCellInput(cell, row, col);
        return;
    }
    
    // For numbers and combinations, use debounce delay
    const timeoutId = setTimeout(() => {
        processCellInput(cell, row, col);
        inputTimeouts.delete(cellKey);
    }, 500); // Wait 500ms after last keystroke
    
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
    
    // Only implement reverse context-awareness if we're not currently editing a clue
    // AND if this focus wasn't triggered by our own focus management
    const isEditingClue = document.activeElement && 
          (document.activeElement.classList.contains('clue-input') || 
           document.activeElement.classList.contains('clue-number-input'));
    
    if (!isEditingClue) {
        // Implement reverse context-awareness: grid cell -> clue
        const row = parseInt(e.target.dataset.row);
        const col = parseInt(e.target.dataset.col);
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
        <input type="number" class="clue-number-input" value="${number}" min="1" max="99" ${isSetupMode ? '' : 'readonly'}>
        <input type="text" class="clue-input" value="${text || ''}" placeholder="Enter clue..." ${isSetupMode ? '' : 'readonly'}>
        <button class="delete-clue-btn" ${isSetupMode ? '' : 'disabled'}>×</button>
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

// Handle New Game button
function handleNewGame() {
    const confirmed = confirm('Are you sure you want to start a new game? This will clear the entire grid and all clues for everyone!');
    
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
    // Clear all grid cells
    for (let row = 0; row < GRID_SIZE; row++) {
        for (let col = 0; col < GRID_SIZE; col++) {
            const container = document.getElementById(`container-${row}-${col}`);
            const cell = document.getElementById(`cell-${row}-${col}`);
            const numberSpan = document.getElementById(`number-${row}-${col}`);
            
            if (container && cell && numberSpan) {
                container.classList.remove('black');
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
    
    // Enable clue editing and buttons
    updateClueInputsMode(false);
    updateClueButtons(false);
    
    console.log('Switched to Setup Mode');
}

// Switch to game mode
function switchToGameMode() {
    isSetupMode = false;
    
    // Update button states
    document.getElementById('setup-mode-btn').classList.remove('active');
    document.getElementById('game-mode-btn').classList.add('active');
    
    // Disable clue editing and buttons
    updateClueInputsMode(true);
    updateClueButtons(true);
    
    console.log('Switched to Game Mode');
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
        btn.disabled = disabled;
    });
    
    deleteBtns.forEach(btn => {
        btn.disabled = disabled;
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
    
    // Find the clue text
    const clueItem = document.querySelector(`[data-direction="${direction}"][data-number="${number}"]`);
    let clueText = '';
    
    if (clueItem) {
        const clueInput = clueItem.querySelector('.clue-input');
        clueText = clueInput ? clueInput.value : '';
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