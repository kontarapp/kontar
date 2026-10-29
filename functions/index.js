// functions/index.js
const { onRequest } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
admin.initializeApp();
const { criarApp } = require('./src/app');
const { criarRepo } = require('./src/repo');
exports.api = onRequest({ region: 'southamerica-east1', memory: '512MiB', timeoutSeconds: 120 },
  criarApp({ repo: criarRepo(admin.firestore()) }));
