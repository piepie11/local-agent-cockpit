function extractToken(req) {
  const header = req.get('x-admin-token') || '';
  if (header) return header;
  const auth = req.get('authorization') || '';
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice('bearer '.length).trim();
  const queryToken = req.query?.token;
  if (typeof queryToken === 'string' && queryToken) return queryToken;
  return '';
}

function requireAdmin({ config }) {
  return (req, res, next) => {
    if (config.readOnlyMode) {
      res.status(403).json({ error: 'READ_ONLY_MODE' });
      return;
    }
    const token = extractToken(req);
    if (!token || token !== config.adminToken) {
      res.status(401).json({ error: 'UNAUTHORIZED' });
      return;
    }
    next();
  };
}

module.exports = { requireAdmin, extractToken };

