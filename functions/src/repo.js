// functions/src/repo.js (cresce nas tasks seguintes)
const { FieldValue } = require('firebase-admin/firestore');
function criarRepo(db) {
  return {
    db,
    async clientePorTokenHash(hash) {
      const s = await db.collection('clientes').where('integracao.tokenHash', '==', hash).limit(1).get();
      if (s.empty) return null;
      const d = s.docs[0]; return { id: d.id, nome: d.data().nome || d.id };
    },
    async registrarLog(clienteId, item) {
      await db.collection('clientes').doc(clienteId).collection('integracao_log').add(Object.assign({ em: FieldValue.serverTimestamp() }, item));
    }
  };
}
module.exports = { criarRepo };
