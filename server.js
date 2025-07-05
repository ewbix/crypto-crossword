const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const port = 3000;

// Store the current state
let gameState = {
  grid: {},
  clues: { across: '', down: '' }
};

// Store updates for polling
let updates = [];
let updateId = 0;

// Create HTTP server
const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  
  // Handle API endpoints
  if (pathname === '/api/state') {
    // Get current state
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(gameState));
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
          gameState.clues[data.clueType] = data.value;
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
    // Get updates since last check
    const since = parseInt(parsedUrl.query.since || '0');
    const newUpdates = updates.filter(update => update.id > since);
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(newUpdates));
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