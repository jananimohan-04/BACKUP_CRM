// Vercel Serverless Function entry point for ERP ↔ Retail Store API
const { handleRetailSyncRequest } = require('../server/retailSyncHandler.cjs');

module.exports = async (req, res) => {
  return handleRetailSyncRequest(req, res);
};
