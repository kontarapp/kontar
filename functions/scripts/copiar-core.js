// Copia lib/inv-bip-core.js do app para functions/lib/ (deploy só empacota functions/).
const fs = require('fs'); const path = require('path');
const origem = path.join(__dirname, '..', '..', 'lib', 'inv-bip-core.js');
const destino = path.join(__dirname, '..', 'lib', 'inv-bip-core.js');
fs.mkdirSync(path.dirname(destino), { recursive: true });
fs.copyFileSync(origem, destino);
console.log('inv-bip-core.js copiado');
