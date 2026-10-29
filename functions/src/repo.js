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
    },
    async listarBalancos(clienteId, f) {
      let q = db.collection('inv_inventarios').where('clienteId', '==', clienteId);
      if (f.loja) q = q.where('loja', '==', f.loja);
      if (f.status) q = q.where('status', '==', f.status);
      const s = await q.get(); return s.docs.map(d => Object.assign({ id: d.id }, d.data()));
    },
    async obterBalanco(clienteId, id) {
      const d = await db.collection('inv_inventarios').doc(id).get();
      if (!d.exists || d.data().clienteId !== clienteId) return null;
      return Object.assign({ id: d.id }, d.data());
    },
    async contarBipagens(invId) {
      const s = await db.collection('inv_bipagens').where('invId', '==', invId).count().get();
      return s.data().count;
    }
  };
}
module.exports = { criarRepo };
