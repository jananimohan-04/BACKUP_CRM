// Standalone integration server for production Node.js deployment
const http = require('http');
const { handleRetailSyncRequest } = require('./retailSyncHandler.cjs');

const PORT = process.env.SYNC_PORT || 5174;

const server = http.createServer((req, res) => {
  // CORS headers for internal API calls
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-erp-api-key, x-company-id, x-idempotency-key');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  if (req.url.startsWith('/api/retail-sync')) {
    return handleRetailSyncRequest(req, res);
  }

  res.statusCode = 404;
  res.end('Not Found');
});

server.listen(PORT, () => {
  console.log(`ERP Retail Sync Service running on http://localhost:${PORT}`);
});

module.exports = server;
