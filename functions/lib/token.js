const crypto = require('crypto');
function gerarToken() { return crypto.randomBytes(24).toString('hex'); }
function hashToken(t) { return crypto.createHash('sha256').update(String(t)).digest('hex'); }
module.exports = { gerarToken, hashToken };
