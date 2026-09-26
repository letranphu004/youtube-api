'use strict';

// Vercel serverless function: GET /api/channels
const youtube = require('../lib/youtube');

module.exports = function (req, res) {
  const force = req.query && req.query.force === '1';
  youtube.getPayload(force).then(function (payload) {
    // Let Vercel's edge cache absorb repeated requests between refreshes.
    res.setHeader('Cache-Control', 's-maxage=' + Math.max(30, payload.refreshSeconds - 10) + ', stale-while-revalidate=30');
    res.status(200).json(payload);
  }).catch(function (e) {
    console.error('[api]', e);
    res.status(500).json({ error: e.message });
  });
};
