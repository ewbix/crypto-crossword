// Crossword grid setup
const GRID_SIZE = 15;
let currentCell = null;
let lastUpdateId = 0;

// DOM elements - will be initialized when DOM is ready
let gridElement, acrossClues, downClues, statusElement;

// Initialize HTTP polling
function initializePolling() {
    console.log('Initializing HTTP polling...');
    
    // Load initial state
    loadInitialState();
    
    // Start polling for updates
    startPolling();
    
    statusElement.textContent = 'Connected';
    statusElement.className = 'connected';
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
            const cell = document.getElementById(`cell-${row}-${col}`);
            const cellData = gameState.grid[key];
            
            if (cell && cellData) {
                if (cellData.isBlack) {
                    cell.classList.add('black');
                    cell.disabled = true;
                    cell.value = '';
                } else {
                    cell.classList.remove('black');
                    cell.disabled = false;
                    cell.value = cellData.value || '';
                }
            }
        });
        
        // Update clues
        acrossClues.value = gameState.clues.across || '';
        downClues.value = gameState.clues.down || '';
        
    } catch (error) {
        console.error('Failed to load initial state:', error);
        statusElement.textContent = 'Connection Error';
        statusElement.className = '';
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
            
            statusElement.textContent = 'Connected';
            statusElement.className = 'connected';
            
        } catch (error) {
            console.error('Polling error:', error);
            statusElement.textContent = 'Connection Error';
            statusElement.className = '';
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
        const cell = document.getElementById(`cell-${row}-${col}`);
        const cellData = data.value;
        
        if (cell && cellData) {
            if (cellData.isBlack) {
                cell.classList.add('black');
                cell.disabled = true;
                cell.value = '';
            } else {
                cell.classList.remove('black');
                cell.disabled = false;
                if (cell.value !== cellData.value) {
                    cell.value = cellData.value || '';
                }
            }
        }
        
    } else if (data.type === 'clue-update') {
        // Update clues
        if (data.clueType === 'across' && acrossClues.value !== data.value) {
            acrossClues.value = data.value;
        } else if (data.clueType === 'down' && downClues.value !== data.value) {
            downClues.value = data.value;
        }
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
            const cell = document.createElement('input');
            cell.className = 'grid-cell';
            cell.type = 'text';
            cell.maxLength = 1;
            cell.dataset.row = row;
            cell.dataset.col = col;
            cell.id = `cell-${row}-${col}`;
            
            // Add event listeners
            cell.addEventListener('input', handleCellInput);
            cell.addEventListener('focus', handleCellFocus);
            cell.addEventListener('keydown', handleKeyDown);
            cell.addEventListener('contextmenu', handleRightClick);
            
            gridElement.appendChild(cell);
        }
    }
}

// Handle cell input
function handleCellInput(e) {
    const cell = e.target;
    const row = parseInt(cell.dataset.row);
    const col = parseInt(cell.dataset.col);
    const value = cell.value.toUpperCase();
    
    const cellData = {
        value: value,
        isBlack: false
    };
    
    // Send to server
    sendToServer({
        type: 'grid-update',
        key: `${row}-${col}`,
        value: cellData
    });
    
    // Move to next cell if letter was entered
    if (value && /[A-Z]/.test(value)) {
        moveToNextCell(row, col);
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
            }
            break;
    }
}

// Handle right-click to toggle black cells
function handleRightClick(e) {
    e.preventDefault();
    const cell = e.target;
    const row = parseInt(cell.dataset.row);
    const col = parseInt(cell.dataset.col);
    
    const isBlack = cell.classList.contains('black');
    
    const cellData = {
        value: '',
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
        cell.classList.add('black');
        cell.disabled = true;
        cell.value = '';
    } else {
        cell.classList.remove('black');
        cell.disabled = false;
    }
}

// Move to specific cell
function moveTo(row, col) {
    if (row >= 0 && row < GRID_SIZE && col >= 0 && col < GRID_SIZE) {
        const cell = document.getElementById(`cell-${row}-${col}`);
        if (cell && !cell.classList.contains('black')) {
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

// Handle clue changes
function handleClueChange(type) {
    const clueText = type === 'across' ? acrossClues.value : downClues.value;
    
    sendToServer({
        type: 'clue-update',
        clueType: type,
        value: clueText
    });
}

// Initialize the grid when page loads
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM loaded, getting elements...');
    
    // Get DOM elements
    gridElement = document.getElementById('crossword-grid');
    acrossClues = document.getElementById('across-clues');
    downClues = document.getElementById('down-clues');
    statusElement = document.getElementById('status');
    
    console.log('Creating grid...');
    createGrid();
    
    // Add event listeners for clues
    acrossClues.addEventListener('input', () => handleClueChange('across'));
    downClues.addEventListener('input', () => handleClueChange('down'));
    
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