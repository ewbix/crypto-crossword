// Crossword grid setup
const GRID_SIZE = 15;
let currentCell = null;
let lastUpdateId = 0;
let inputTimeouts = new Map(); // Store timeouts for each cell
let isSetupMode = true; // Track current mode

// DOM elements - will be initialized when DOM is ready
let gridElement, acrossCluesList, downCluesList, connectionDot;

// Initialize HTTP polling
function initializePolling() {
    console.log('Initializing HTTP polling...');
    
    // Load initial state
    loadInitialState();
    
    // Start polling for updates
    startPolling();
    
    connectionDot.className = 'connection-dot connected';
}

// Load initial state from server
async function loadInitialState() {
    try {
        const response = await fetch('/api/state');
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
        
    } catch (error) {
        console.error('Failed to load initial state:', error);
        connectionDot.className = 'connection-dot';
    }
}

// Start polling for updates
function startPolling() {
    const pollForUpdates = async () => {
        try {
            const response = await fetch(`/api/updates?since=${lastUpdateId}`);
            const updates = await response.json();
            
            updates.forEach(update => {
                handleServerUpdate(update.data);
                lastUpdateId = Math.max(lastUpdateId, update.id);
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
    
    // Only allow letters and numbers, max 2 characters
    value = value.replace(/[^A-Za-z0-9]/g, '');
    if (value.length > 2) {
        value = value.slice(0, 2);
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
    
    // Clear any existing timeout for this cell
    if (inputTimeouts.has(cellKey)) {
        clearTimeout(inputTimeouts.get(cellKey));
    }
    
    // If it's just a single letter in setup mode, process immediately (no delay)
    if (isSetupMode && /^[A-Za-z]$/.test(value)) {
        console.log('Setup mode: immediate letter processing:', value);
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
            
            // Move to next cell if letter was entered
            moveToNextCell(row, col);
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
            if (!currentCell.value) {
                e.preventDefault();
                moveToPreviousCell(row, col);
            } else {
                // Clear the cell and sync the deletion
                e.preventDefault();
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
                
                // Move to previous cell after deletion
                moveToPreviousCell(row, col);
            }
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

// Move to next cell (right, then down)
function moveToNextCell(row, col) {
    if (col + 1 < GRID_SIZE) {
        moveTo(row, col + 1);
    } else if (row + 1 < GRID_SIZE) {
        moveTo(row + 1, 0);
    }
}

// Move to previous cell (left, then up)
function moveToPreviousCell(row, col) {
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
        <span class="clue-number">${number}</span>
        <input type="text" class="clue-input" value="${text || ''}" placeholder="Enter clue..." ${isSetupMode ? '' : 'readonly'}>
        <button class="delete-clue-btn" ${isSetupMode ? '' : 'disabled'}>×</button>
    `;
    
    // Add event listeners
    const input = clueItem.querySelector('.clue-input');
    const deleteBtn = clueItem.querySelector('.delete-clue-btn');
    
    input.addEventListener('input', (e) => {
        sendToServer({
            type: 'clue-update',
            direction: direction,
            number: number,
            text: e.target.value
        });
    });
    
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
        if (input.value !== text) {
            input.value = text;
        }
    } else {
        // Clue doesn't exist, add it
        addClueToDisplay(direction, number, text);
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
    
    // Focus the new input
    setTimeout(() => {
        const newClueInput = document.querySelector(`[data-direction="${direction}"][data-number="${nextNumber}"] .clue-input`);
        if (newClueInput) {
            newClueInput.focus();
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
    clueInputs.forEach(input => {
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

// Initialize the grid when page loads
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM loaded, getting elements...');
    
    // Get DOM elements
    gridElement = document.getElementById('crossword-grid');
    acrossCluesList = document.getElementById('across-clues-list');
    downCluesList = document.getElementById('down-clues-list');
    connectionDot = document.getElementById('connection-dot');
    
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