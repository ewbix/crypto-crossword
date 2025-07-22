const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const port = process.env.PORT || 3000;

// Store the current state
let gameState = {
  grid: {},
  clues: { across: {}, down: {} }
};

// Store updates for polling
let updates = [];
let updateId = 0;

// Track connected clients with timeout cleanup
let connectedClients = new Map(); // clientId -> lastSeen timestamp
let clientCounter = 0;
const CLIENT_TIMEOUT = 3000; // 3 seconds timeout for faster testing

// Track user presence data
let userPresence = new Map(); // clientId -> { color, position, lastSeen }

// Clear any stale presence data on server start
console.log('Server starting - clearing any stale presence data');

// Clean up inactive clients
function cleanupClients() {
  const now = Date.now();
  for (const [clientId, lastSeen] of connectedClients.entries()) {
    if (now - lastSeen > CLIENT_TIMEOUT) {
      connectedClients.delete(clientId);
      userPresence.delete(clientId); // Also clean up presence data
    }
  }
}

// Create HTTP server
const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  
  // Handle API endpoints
  if (pathname === '/api/state') {
    // Get current state and register client
    const clientId = req.headers['x-client-id'];
    if (clientId) {
      connectedClients.set(clientId, Date.now());
    }
    cleanupClients();
    
    // Clean up stale presence data before sending
    const now = Date.now();
    
    const staleClients = [];
    for (const [clientId, data] of userPresence.entries()) {
      const age = now - data.lastSeen;
      if (age > CLIENT_TIMEOUT) {
        staleClients.push(clientId);
      }
    }
    
    staleClients.forEach(clientId => {
      userPresence.delete(clientId);
    });
    
    const response = {
      ...gameState,
      clientCount: connectedClients.size,
      userPresence: Array.from(userPresence.entries()).map(([clientId, data]) => ({
        clientId,
        ...data
      }))
    };
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response));
    return;
  }
  
  if (pathname === '/api/update' && req.method === 'POST') {
    // Handle state updates
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        
        if (data.type === 'grid-update') {
          gameState.grid[data.key] = data.value;
        } else if (data.type === 'clue-update') {
          if (data.text && data.text.trim() !== '') {
            gameState.clues[data.direction][data.number] = data.text;
          } else {
            // If text is empty, delete the clue instead
            delete gameState.clues[data.direction][data.number];
          }
        } else if (data.type === 'clue-delete') {
          delete gameState.clues[data.direction][data.number];
        } else if (data.type === 'clues-update') {
          // Handle bulk clue updates (used by import feature)
          if (data.across) {
            Object.entries(data.across).forEach(([number, text]) => {
              if (text && text.trim() !== '') {
                gameState.clues.across[number] = text;
              }
            });
          }
          if (data.down) {
            Object.entries(data.down).forEach(([number, text]) => {
              if (text && text.trim() !== '') {
                gameState.clues.down[number] = text;
              }
            });
          }
        } else if (data.type === 'clear-all') {
          // Clear everything
          gameState.grid = {};
          gameState.clues = { across: {}, down: {} };
          console.log('Game cleared by user request');
        }
        
        // Add to updates list
        updates.push({
          id: ++updateId,
          timestamp: Date.now(),
          data: data
        });
        
        // Keep only last 100 updates
        if (updates.length > 100) {
          updates = updates.slice(-100);
        }
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (error) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }
  
  if (pathname === '/api/updates') {
    // Get updates since last check and register client
    const clientId = req.headers['x-client-id'];
    if (clientId) {
      connectedClients.set(clientId, Date.now());
    }
    cleanupClients();
    
    const since = parseInt(parsedUrl.query.since || '0');
    const newUpdates = updates.filter(update => update.id > since);
    
    // Add client count update if it changed (but don't spam)
    const currentClientCount = connectedClients.size;
    const lastClientCountUpdate = updates.slice().reverse().find(u => u.type === 'client-count');
    if (!lastClientCountUpdate || lastClientCountUpdate.clientCount !== currentClientCount) {
      newUpdates.push({
        id: -1, // Special ID for client count
        type: 'client-count',
        clientCount: currentClientCount,
        timestamp: Date.now()
      });
    }
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(newUpdates));
    return;
  }
  
  if (pathname === '/api/disconnect' && req.method === 'POST') {
    // Handle client disconnect
    const clientId = req.headers['x-client-id'];
    if (clientId) {
      connectedClients.delete(clientId);
      userPresence.delete(clientId);
      
      // Broadcast disconnect to other clients
      updates.push({
        id: ++updateId,
        type: 'presence-update',
        timestamp: Date.now(),
        data: {
          type: 'presence-update',
          clientId: clientId,
          color: null,
          position: null // Clear position on disconnect
        }
      });
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    } else {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing client ID' }));
    }
    return;
  }
  
  if (pathname === '/api/presence' && req.method === 'POST') {
    // Handle user presence updates
    const clientId = req.headers['x-client-id'];
    if (!clientId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing client ID' }));
      return;
    }
    
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        
        // Update or clear user presence
        if (data.position === null) {
          // Clear user presence when position is null
          userPresence.delete(clientId);
        } else {
          // Update user presence
          userPresence.set(clientId, {
            color: data.color,
            position: data.position,
            lastSeen: Date.now()
          });
        }
        
        // Register client as active
        connectedClients.set(clientId, Date.now());
        
        // Add presence update to the updates stream
        updates.push({
          id: ++updateId,
          type: 'presence-update',
          timestamp: Date.now(),
          data: {
            type: 'presence-update',
            clientId: clientId,
            color: data.color,
            position: data.position // This can be null to clear presence
          }
        });
        
        // Keep only last 100 updates
        if (updates.length > 100) {
          updates = updates.slice(-100);
        }
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (error) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }
  
  // Serve static files
  let filePath = '.' + pathname;
  if (filePath === './') {
    filePath = './index.html';
  }

  const extname = String(path.extname(filePath)).toLowerCase();
  const mimeTypes = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
  };

  const contentType = mimeTypes[extname] || 'application/octet-stream';

  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (error.code === 'ENOENT') {
        res.writeHead(404);
        res.end('File not found');
      } else {
        res.writeHead(500);
        res.end('Server error');
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    }
  });
});

server.listen(port, () => {
  console.log(`Server running at http://localhost:${port}/`);
  console.log(`API endpoints available at /api/state, /api/update, /api/updates`);
});