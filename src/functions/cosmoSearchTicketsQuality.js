// src/functions/searchTicketsQuality/index.js (CommonJS)
const { app } = require('@azure/functions');
const { success, error, badRequest } = require('../shared/responseUtils');

// 🔐 Auth utils
const { withAuth } = require('./auth/withAuth');
const { GROUPS } = require('./auth/groups.config');

// Limita el acceso SOLO al grupo de QUALITY
const { QUALITY_GROUP } = GROUPS.QUALITY;

// === Config Cognitive Search ===
const congnitiveURL = process.env.COGNITIVE_AI_URL;     // ojo: mantiene tu nombre de var
const cognitiveKEY  = process.env.COGNITIVE_AI_API_KEY; // api-key
const indexName     = 'index-tickets';

// ===== Helpers de validación/transformación =====
function cleanQueryInput(raw) {
  if (!raw) return '';
  return raw.replace(/^[CH]:\s*/i, '').replace(/[^\dA-Za-z\s@.-]/g, '').trim();
}

function buildFilter(filters = {}) {
  const parts = [];

  if (filters.status) {
    parts.push(`status eq '${filters.status}'`);
  }

  if (filters.assigned_department) {
    parts.push(`assigned_department eq '${filters.assigned_department}'`);
  }

  if (filters.createdAt) {
    const { from, to } = filters.createdAt;
    if (from) parts.push(`createdAt ge ${from}`);
    if (to)   parts.push(`createdAt le ${to}`);
  }

  return parts.length ? parts.join(' and ') : null;
}

function validateFilterString(filter) {
  // Campos y operadores permitidos para OData filter
  const allowedFields = ['status', 'assigned_department', 'createdAt', 'agent_assigned'];
  const allowedOps = ['eq', 'ge', 'le'];

  const conditions = filter.split(/and/i).map(s => s.trim()).filter(Boolean);

  for (const cond of conditions) {
    const parts = cond.split(/\s+/);
    if (parts.length < 3) {
      return `Invalid filter condition: ${cond}`;
    }
    const [field, op] = parts;
    if (!allowedFields.includes(field)) {
      return `Invalid field in filter: ${field}`;
    }
    if (!allowedOps.includes(op)) {
      return `Invalid operator in filter: ${op}`;
    }
  }
  return null; // OK
}

// ===== Function =====
app.http('searchTicketsQuality', {
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: withAuth(async (request, context) => {
    // (Opcional) Podrías auditar quién consulta:
    // const email = (context.user?.preferred_username || context.user?.upn || context.user?.email || '').toLowerCase();
    // context.log(`QUALITY search by: ${email}`);

    let body;
    try {
      body = await request.json();
    } catch (err) {
      return badRequest('Invalid JSON', err.message);
    }

    const { query, page = 1, size = 50, filters = {}, filter } = body;

    if (!query && !filter && Object.keys(filters).length === 0) {
      return badRequest('Provide at least a query or filters');
    }

    // Si quieres evitar *:
    // if (query === '*') return badRequest('Avoid using wildcard search (*)');

    const cleanedQuery = cleanQueryInput(query);
    const safePage = Number.isInteger(page) && page > 0 ? page : 1;
    const safeSize = Number.isInteger(size) && size > 0 ? size : 50;
    const skip = (safePage - 1) * safeSize;

    const searchPayload = {
      search: cleanedQuery || "*",
      top: safeSize,
      skip,
      count: true,
      searchFields: cleanedQuery
        ? 'caller_id,phone,patient_name,agent_assigned,assigned_department, patient_id'
        : undefined,
    };

    // ✅ Validar y asignar filtro
    if (filter) {
      const validationError = validateFilterString(filter);
      if (validationError) {
        return badRequest(`Invalid filter: ${validationError}`);
      }
      searchPayload.filter = filter;
    } else {
      const filterString = buildFilter(filters);
      if (filterString) {
        searchPayload.filter = filterString;
      }
    }

    try {
      const response = await fetch(
        `${congnitiveURL}/indexes/${indexName}/docs/search?api-version=2025-05-01-Preview`,
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
        const errorMsg = await response.text();
        throw new Error(`Search failed: ${response.status} ${response.statusText} - ${errorMsg}`);
      }

      const data = await response.json();
      return success('Search completed', data, 200);
    } catch (err) {
      context.log(err.message);
      return error('Search error', 500, err.message);
    }
  }, {
    // 🔐 Requiere scope del API (si lo usas en tu app registration)
    scopesAny: ['access_as_user'],
    // 🔐 SOLO miembros del grupo de QUALITY
    groupsAny: [QUALITY_GROUP],
  })
});
