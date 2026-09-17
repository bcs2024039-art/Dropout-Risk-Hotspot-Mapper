const fs = require('fs');
let code = fs.readFileSync('server.js', 'utf8');
code = code.replace(/app\.use\('\/api', createProxyMiddleware\(\{[\s\S]*?\}\)\);/, 
`app.use(createProxyMiddleware({ 
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
}));`);
fs.writeFileSync('server.js', code);
