// src/functions/searchTickets/index.js (CommonJS)
const { app } = require('@azure/functions');
const fetch = require('node-fetch');
const Joi = require('joi');
const { success, error, badRequest } = require('../shared/responseUtils');

// --- Auth ---
const { withAuth } = require('./auth/withAuth');
const { GROUPS } = require('./auth/groups.config');
const {searchBodySchema} = require('./dtos/input.schema');
const { SUPERVISORS_GROUP: GROUP_REFERRALS_SUPERVISORS } = GROUPS.REFERRALS;

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
function buildFilter(filters = {}) {
  const parts = [];
  if (filters.status) parts.push(`status eq '${filters.status}'`);
  if (filters.assigned_department) parts.push(`assigned_department eq '${filters.assigned_department}'`);
  if (filters.createdAt) {
    const { from, to } = filters.createdAt;
    if (from) parts.push(`createdAt ge ${from}`);
    if (to) parts.push(`createdAt le ${to}`);
  }
  return parts.length ? parts.join(' and ') : null;
}
function validateFilterString(filter) {
  const allowedFields = ['status', 'assigned_department', 'createdAt', 'agent_assigned'];
  const allowedOps = ['eq', 'ge', 'le'];
  const conditions = filter.split('and').map(s => s.trim());
  for (const cond of conditions) {
    const parts = cond.split(/\s+/);
    if (parts.length < 3) return `Invalid filter condition: ${cond}`;
    const [field, op] = parts;
    if (!allowedFields.includes(field)) return `Invalid field in filter: ${field}`;
    if (!allowedOps.includes(op)) return `Invalid operator in filter: ${op}`;
  }
  return null;
}

// ---------- DTO entrada ----------
/*const createdAtRange = Joi.object({
  from: Joi.string().isoDate().optional(),
  to:   Joi.string().isoDate().optional(),
}).optional();

const searchBodySchema = Joi.object({
  query:  Joi.string().allow('', null),
  page:   Joi.number().integer().min(1).default(1),
  size:   Joi.number().integer().min(1).max(200).default(50),
  filters: Joi.object({
    status: Joi.string().optional(),
    assigned_department: Joi.string().optional(),
    createdAt: createdAtRange
  }).default({}),
  filter: Joi.string().optional()
});*/

app.http('searchTickets', {
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: withAuth(async (request, context) => {
    // ---- defensa en profundidad: solo supervisores ----
    const claims = context.user || {};
    const tokenGroups = Array.isArray(claims.groups) ? claims.groups : [];
    context.log(`🔒 groups in token: ${JSON.stringify(tokenGroups)}`);
    if (!tokenGroups.includes(GROUP_REFERRALS_SUPERVISORS)) {
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
    if (query === '*') {
      return badRequest('Avoid using wildcard search (*).');
    }

    const cleanedQuery = cleanQueryInput(query);
    const skip = (page - 1) * size;

    const searchPayload = {
      search: cleanedQuery || "*",
      top: size,
      skip,
      count: true,
      searchFields: cleanedQuery
        ? 'caller_id,phone,patient_name,agent_assigned,assigned_department,patient_id'
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
    groupsAny: [GROUP_REFERRALS_SUPERVISORS],
  })
});
