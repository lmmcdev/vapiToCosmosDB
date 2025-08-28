// src/functions/searchTickets/index.js (CommonJS)
const { app } = require('@azure/functions');
const fetch = require('node-fetch');
const Joi = require('joi');
const { success, error, badRequest } = require('../shared/responseUtils');

// --- Auth ---
const { withAuth } = require('./auth/withAuth');
const { GROUPS } = require('./auth/groups.config');
const { searchBodySchema } = require('./dtos/input.schema');
const { SUPERVISORS_GROUP: GROUP_SUPERVISORS } = GROUPS.SWITCHBOARD || {};

// --- Config Search ---
const congnitiveURL = process.env.COGNITIVE_AI_URL;
const cognitiveKEY  = process.env.COGNITIVE_AI_API_KEY;
const API_VERSION   = process.env.SEARCH_API_VERSION || '2025-05-01-Preview';
const indexName     = 'index-tickets';

// ---------- Helpers -----------
function cleanQueryInput(raw) {
  if (!raw) return '';
  return raw.replace(/^[CH]:\s*/i, '').replace(/[^\dA-Za-z\s@.-]/g, '').trim();
}

// OData: escapar comillas simples en literales '...'
function escapeODataLiteral(v) {
  return String(v ?? '').replace(/'/g, "''");
}

function buildFilter(filters = {}) {
  const parts = [];

  // Igualdades simples
  if (filters.status) {
    parts.push(`status eq '${escapeODataLiteral(filters.status)}'`);
  }
  if (filters.assigned_department) {
    parts.push(`assigned_department eq '${escapeODataLiteral(filters.assigned_department)}'`);
  }
  if (filters.agent_assigned) {
    parts.push(`agent_assigned eq '${escapeODataLiteral(filters.agent_assigned)}'`);
  }

  // Rango de fechas (asumiendo filtros.createdAt.from/to vienen como 2024-01-01T00:00:00Z o yyyy-mm-dd)
  if (filters.createdAt) {
    const { from, to } = filters.createdAt || {};
    if (from) parts.push(`createdAt ge ${from}`);
    if (to)   parts.push(`createdAt le ${to}`);
  }

  // —— NUEVO: campo complejo linked_patient_snapshot/Name ——
  // Igualdad exacta
  const linkedSnap = filters.linked_patient_snapshot;
  if (linkedSnap && typeof linkedSnap === 'object' && linkedSnap.Name) {
    parts.push(`linked_patient_snapshot/Name eq '${escapeODataLiteral(linkedSnap.Name)}'`);
  }
  // Búsqueda parcial vía search.ismatch (cuando pidas "contiene")
  if (filters.linked_patient_name_contains) {
    const term = escapeODataLiteral(filters.linked_patient_name_contains);
    // Nota: search.ismatch solo se permite en el $filter de ACS
    parts.push(`search.ismatch('${term}', 'linked_patient_snapshot/Name')`);
  }

  return parts.length ? parts.join(' and ') : null;
}

function validateFilterString(filter) {
  // Permitimos dos tipos de condiciones:
  //   1) OData simples: "<field> <op> <value>"
  //   2) Funciones search.ismatch('term','field')
  const allowedFields = [
    'status',
    'assigned_department',
    'createdAt',
    'agent_assigned',
    // —— NUEVO: campo complejo ——
    'linked_patient_snapshot/Name',
  ];
  const allowedOps = ['eq', 'ge', 'le'];

  // Dividir por AND de forma básica (no parsea paréntesis complejos, suficiente para nuestro uso)
  const conditions = String(filter).split(/\band\b/i).map(s => s.trim()).filter(Boolean);

  for (const cond of conditions) {
    // A) Permite funciones de búsqueda: search.ismatch('x','y')
    if (/^search\.ismatch\s*\(/i.test(cond)) {
      // Validación mínima: que tenga dos argumentos y cierre paréntesis
      if (!/\)$/.test(cond)) return `Invalid function syntax: ${cond}`;
      continue;
    }

    // B) Validación OData simple: "<field> <op> ..."
    const parts = cond.split(/\s+/);
    if (parts.length < 3) return `Invalid filter condition: ${cond}`;

    const field = parts[0];
    const op = parts[1];

    if (!allowedFields.includes(field)) return `Invalid field in filter: ${field}`;
    if (!allowedOps.includes(op)) return `Invalid operator in filter: ${op}`;
  }
  return null;
}

// ---------- Endpoint ----------
app.http('searchTickets', {
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: withAuth(async (request, context) => {
    // ---- defensa en profundidad: solo supervisores ----
    const claims = context.user || {};
    const tokenGroups = Array.isArray(claims.groups) ? claims.groups : [];
    context.log(`🔒 groups in token: ${JSON.stringify(tokenGroups)}`);
    if (!tokenGroups.includes(GROUP_SUPERVISORS)) {
      return { status: 403, jsonBody: { error: 'Supervisors only' } };
    }

    // ---- valida body ----
    let body;
    try {
      body = await request.json();
    } catch {
      return badRequest('Invalid JSON body.');
    }
    const { error: dtoErr, value } = searchBodySchema.validate(body, { abortEarly: false });
    if (dtoErr) {
      const msg = dtoErr.details?.map(d => d.message).join('; ') || dtoErr.message;
      return badRequest(`Validation error: ${msg}`);
    }

    const { query, page, size, filters, filter } = value;

    if (!query && !filter && Object.keys(filters).length === 0) {
      return badRequest('Provide at least a query or filters.');
    }

    const cleanedQuery = cleanQueryInput(query);
    const skip = (page - 1) * size;

    const searchPayload = {
      search: cleanedQuery || "*",
      top: size,
      skip,
      count: true,
      // —— Añadimos el campo anidado a searchFields para cuando se mande "query" ——
      searchFields: cleanedQuery
        ? 'caller_id,phone,patient_name,agent_assigned,assigned_department,patient_id,linked_patient_snapshot/Name'
        : undefined,
    };

    if (filter) {
      const v = validateFilterString(filter);
      if (v) return badRequest(`Invalid filter: ${v}`);
      searchPayload.filter = filter;
    } else {
      const filterString = buildFilter(filters);
      if (filterString) searchPayload.filter = filterString;
    }

    try {
      const response = await fetch(
        `${congnitiveURL}/indexes/${indexName}/docs/search?api-version=${encodeURIComponent(API_VERSION)}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'api-key': cognitiveKEY
          },
          body: JSON.stringify(searchPayload)
        }
      );

      if (!response.ok) {
        const errorMsg = await response.text().catch(() => '');
        throw new Error(`Search failed: ${response.status} ${response.statusText} - ${errorMsg}`);
      }

      const data = await response.json();
      return success('Search completed', data, 200);
    } catch (err) {
      context.log(err.message);
      return error('Search error', 500, err.message);
    }
  }, {
    // 🔐 SOLO supervisores (no ACCESS_GROUP, no AGENTS_GROUP)
    scopesAny: ['access_as_user'],
    groupsAny: [GROUP_SUPERVISORS],
  })
});
