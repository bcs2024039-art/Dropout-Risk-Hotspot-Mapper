import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn, execSync } from 'child_process';
import { createProxyMiddleware } from 'http-proxy-middleware';

if (fs.existsSync('.env')) {
    process.loadEnvFile('.env');
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

let pyProcess = null;
let isShuttingDown = false;

function startBackend() {
  if (isShuttingDown) return;

  try {
    console.log('Cleaning up any existing uvicorn processes...');
    execSync('pkill -f "uvicorn backend.app.main:app"');
  } catch (e) {
    // Ignore errors if no process was found
  }

  const env = { ...process.env };
  const venvPython = path.join(__dirname, '.venv', 'bin', 'python');
  const pythonCmd = fs.existsSync(venvPython) ? venvPython : 'python3';

  console.log(`Spawning python backend using ${pythonCmd} on port 8001...`);
  pyProcess = spawn(pythonCmd, ['-m', 'uvicorn', 'backend.app.main:app', '--host', '0.0.0.0', '--port', '8001'], { 
    stdio: 'inherit',
    env
  });

  pyProcess.on('error', (err) => {
    console.error('Failed to start python backend:', err);
  });

  pyProcess.on('exit', (code, signal) => {
    if (!isShuttingDown) {
      console.warn(`Python backend exited (code ${code}, signal ${signal}). Respawning in 3s...`);
      setTimeout(startBackend, 3000);
    }
  });
}

startBackend();

const cleanup = () => {
  isShuttingDown = true;
  if (pyProcess) {
    try { pyProcess.kill('SIGTERM'); } catch (e) {}
  }
};
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(); });
process.on('SIGTERM', () => { cleanup(); process.exit(); });

app.use(createProxyMiddleware({ 
  pathFilter: '/api',
  target: 'http://127.0.0.1:8001', 
  changeOrigin: true,
  on: {
    error: (err, req, res) => {
      console.error('Proxy error to backend:', err.message);
      if (res.writeHead && !res.headersSent) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Backend is loading, please retry in a moment' }));
      }
    }
  }
}));

app.use(express.static(path.join(__dirname, 'frontend')));

app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(503).json({ error: 'Backend route not reachable' });
  }
  res.sendFile(path.join(__dirname, 'frontend/index.html'));
});

app.listen(3000, '0.0.0.0', () => {
    console.log('Server running on port 3000, proxying /api to 8001');
});
