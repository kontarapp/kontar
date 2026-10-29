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
    },
    async substituirCatalogo(invId, clienteId, blocos, meta) {
      const col = db.collection('inv_catalogo_blocos');
      const antigos = await col.where('invId', '==', invId).get();
      let b = db.batch(), n = 0;
      const flush = async () => { if (n) { await b.commit(); b = db.batch(); n = 0; } };
      for (const d of antigos.docs) { b.delete(d.ref); if (++n >= 400) await flush(); }
      await flush();
      for (let i = 0; i < blocos.length; i++) { b.set(col.doc(invId + '_' + i), { invId, clienteId, n: i, itens: blocos[i] }); if (++n >= 20) await flush(); }
      await flush();
      const upd = {}; Object.keys(meta).forEach(k => { upd['erp.' + k] = meta[k]; });
      await db.collection('inv_inventarios').doc(invId).update(upd);
    },
    async guardarParteCatalogo(invId, parte, total, itens) {
      await db.collection('inv_inventarios').doc(invId).collection('catalogo_partes').doc(String(parte)).set({ parte, total, itens, em: FieldValue.serverTimestamp() });
    },
    async lerPartesCatalogo(invId) {
      const s = await db.collection('inv_inventarios').doc(invId).collection('catalogo_partes').orderBy('parte').get();
      return s.docs.map(d => d.data().itens);
    },
    async limparPartesCatalogo(invId) {
      const s = await db.collection('inv_inventarios').doc(invId).collection('catalogo_partes').get();
      const b = db.batch(); s.docs.forEach(d => b.delete(d.ref)); await b.commit();
    }
  };
}
module.exports = { criarRepo };
