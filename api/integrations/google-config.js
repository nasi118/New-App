'use strict';

// OAuth client IDs are public configuration. Never return client secrets or tokens.
module.exports = function googleConfig(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const value = String(process.env.GOOGLE_CLIENT_ID || '').trim();
  const clientId = /^\d+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(value) ? value : '';
  return res.status(200).json({ clientId });
};
