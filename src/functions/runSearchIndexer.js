// src/functions/runSearchIndexer/index.js
const { app } = require('@azure/functions');
const fetch = require('node-fetch');
const { success, error, badRequest } = require('../shared/responseUtils');

// ✅ Reusa tu wrapper de auth y grupos
const { withAuth } = require('../searchTickets/auth/withAuth');
const { GROUPS } = require('../searchTickets/auth/groups.config');
const { SUPERVISORS_GROUP: GROUP_REFERRALS_SUPERVISORS } = GROUPS.REFERRALS;

// 🔧 Config (ya las usas en otros endpoints)
const SEARCH_URL = process.env.COGNITIVE_AI_URL;        // p.ej. https://<service>.search.windows.net
const SEARCH_ADMIN_KEY = process.env.COGNITIVE_AI_API_KEY;
const API_VERSION = process.env.SEARCH_API_VERSION || '2023-11-01' // estable para admin ops

app.http('runSearchIndexer', {
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: withAuth(async (req, context) => {
    // Solo supervisores
    const claims = context.user || {};
    const tokenGroups = Array.isArray(claims.groups) ? claims.groups : [];
    if (!tokenGroups.includes(GROUP_REFERRALS_SUPERVISORS)) {
      return { status: 403, jsonBody: { error: 'Supervisors only' } };
    }

    if (!SEARCH_URL || !SEARCH_ADMIN_KEY) {
      return error('Search admin not configured', 500, 'Missing SEARCH_URL or SEARCH_ADMIN_KEY');
    }

    let body;
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const indexerName = body?.indexerName || 'indexer-tickets'; // tu nombre por defecto
    const action = (body?.action || 'run').toLowerCase();       // 'run' | 'reset'

    const path =
      action === 'reset'
        ? `/indexers/${encodeURIComponent(indexerName)}/reset`
        : `/indexers/${encodeURIComponent(indexerName)}/run`;

    const url = `${SEARCH_URL}${path}?api-version=${encodeURIComponent(API_VERSION)}`;

    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'api-key': SEARCH_ADMIN_KEY,
          'Content-Type': 'application/json'
        }
      });

      const text = await resp.text().catch(() => '');
      // La API devuelve 202 Accepted si se aceptó el trabajo
      if (resp.status !== 202) {
        return error(`Indexer ${action} failed`, resp.status, text || resp.statusText);
      }

      // Opcional: podemos pegarle al status para devolver algo más
      const statusUrl = `${SEARCH_URL}/indexers/${encodeURIComponent(indexerName)}/status?api-version=${encodeURIComponent(API_VERSION)}`;
      let statusJson = null;
      try {
        const s = await fetch(statusUrl, {
          headers: { 'api-key': SEARCH_ADMIN_KEY }
        });
        statusJson = await s.json().catch(() => null);
      } catch (_) {}

      return success(`Indexer ${action} accepted`, {
        indexerName,
        status: statusJson || { accepted: true }
      }, 202);
    } catch (e) {
      return error('Search admin error', 500, e.message);
    }
  }, {
    // exige token + pertenencia a grupo de supervisores
    scopesAny: ['access_as_user'],
    groupsAny: [GROUP_REFERRALS_SUPERVISORS],
  })
});
