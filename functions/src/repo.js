// functions/src/repo.js (cresce nas tasks seguintes)
const { FieldValue } = require('firebase-admin/firestore');
const InvCore = require('../lib/inv-bip-core.js');
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
      for (let i = 0; i < blocos.length; i += 20) {
        const b = db.batch();
        for (let j = i; j < Math.min(i + 20, blocos.length); j++) b.set(col.doc(invId + '_' + j), { invId, clienteId, n: j, itens: blocos[j] });
        await b.commit();
      }
      const antigos = await col.where('invId', '==', invId).get();
      const sobra = antigos.docs.filter(d => d.data().n >= blocos.length);
      for (let i = 0; i < sobra.length; i += 400) {
        const b = db.batch(); sobra.slice(i, i + 400).forEach(d => b.delete(d.ref)); await b.commit();
      }
      const upd = {}; Object.keys(meta).forEach(k => { upd['erp.' + k] = meta[k]; });
      await db.collection('inv_inventarios').doc(invId).update(upd);
    },
    async guardarParteCatalogo(invId, parte, total, itens) {
      await db.collection('inv_inventarios').doc(invId).collection('catalogo_partes').doc(String(parte)).set({ parte, total, itens, em: FieldValue.serverTimestamp() });
    },
    async lerPartesCatalogo(invId) {
      const s = await db.collection('inv_inventarios').doc(invId).collection('catalogo_partes').orderBy('parte').get();
      return s.docs.map(d => { const x = d.data(); return { parte: x.parte, total: x.total, itens: x.itens }; });
    },
    async limparPartesCatalogo(invId) {
      const s = await db.collection('inv_inventarios').doc(invId).collection('catalogo_partes').get();
      const b = db.batch(); s.docs.forEach(d => b.delete(d.ref)); await b.commit();
    },
    async lerCatalogo(invId) {
      const s = await db.collection('inv_catalogo_blocos').where('invId', '==', invId).get();
      let itens = []; s.docs.sort((a, b) => (a.data().n || 0) - (b.data().n || 0)).forEach(d => { itens = itens.concat(d.data().itens || []); });
      return InvCore.criarCatalogo(itens);
    },
    async lerBipagens(invId) {
      const s = await db.collection('inv_bipagens').where('invId', '==', invId).get();
      return s.docs.map(d => d.data());
    },
    async balancoPorRefErp(clienteId, refErp) {
      const s = await db.collection('inv_inventarios').where('clienteId', '==', clienteId).where('erp.refErp', '==', refErp).limit(1).get();
      return s.empty ? null : Object.assign({ id: s.docs[0].id }, s.docs[0].data());
    },
    async criarBalanco(clienteId, d) {
      const doc = { nome: d.nome, loja: d.loja, status: 'aberto', tipo: d.tipo, sequencial: d.sequencial, clienteId, enderecos: d.enderecos, setores: d.setores,
        atribuicoes: {}, modoFila: true, fila: {}, totalBipagens: 0, modoOrganizacao: d.setores.length ? 'setores_end' : 'enderecos',
        criadoEm: FieldValue.serverTimestamp(), criadoPor: 'api', origem: 'erp', erp: { refErp: d.refErp } };
      const id = ('erp_' + clienteId + '_' + d.refErp).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 1400);
      const ref = db.collection('inv_inventarios').doc(id);
      let criado = true;
      try { await ref.create(doc); }
      catch (e) { if (e && (e.code === 6 || /ALREADY_EXISTS/i.test(e.message || ''))) criado = false; else throw e; }
      const snap = await ref.get(); const data = snap.data();
      if (!criado && !(data && data.clienteId === clienteId && data.erp && data.erp.refErp === d.refErp))
        throw { code: 'conflito_id', message: 'refErp conflita com outro balanço' };
      return { balanco: Object.assign({ id: ref.id }, data), criado };
    },
    async atualizarBalanco(invId, campos) { await db.collection('inv_inventarios').doc(invId).update(campos); }
  };
}
module.exports = { criarRepo };
