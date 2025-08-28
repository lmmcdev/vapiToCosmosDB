// functions/cosmoUpdateAiClassification/index.js (CommonJS)
const { app } = require('@azure/functions');

const { getContainer } = require('../shared/cosmoClient');
const { success, error, badRequest, notFound } = require('../shared/responseUtils');

// Auth utils
const { withAuth } = require('./auth/withAuth');
const { GROUPS } = require('./auth/groups.config');
const { getEmailFromClaims, getRoleGroups } = require('./auth/auth.helper');

// Hora Miami
const { getMiamiNow } = require('./helpers/timeHelper');

// DTO formatter tolerante
const { validateAndFormatTicket } = require('./helpers/outputDtoHelper');

// ✅ Schemas (separados del endpoint)
const { updateAiClassificationInput } = require('./dtos/input.schema');

// 🔐 Grupos Referrals
const {
  ACCESS_GROUP: GROUP_CUSTOMER_SERVICE,
  SUPERVISORS_GROUP: GROUP_CSERV_SUPERVISORS,
  AGENTS_GROUP: GROUP_CSERV_AGENTS,
} = GROUPS.SWITCHBOARD;

// ----------------- Utils -----------------
const sanitizeAi = (inObj = {}) => {
  const out = {};
  if (inObj.priority !== undefined && inObj.priority !== null) out.priority = String(inObj.priority).trim();
  if (inObj.risk !== undefined && inObj.risk !== null) out.risk = String(inObj.risk).trim();
  if (inObj.category !== undefined && inObj.category !== null) out.category = String(inObj.category).trim();
  return out;
};

const buildChangeSummary = (prev = {}, next = {}) => {
  const fields = ['priority', 'risk', 'category'];
  const diffs = [];
  for (const f of fields) {
    const a = prev?.[f] ?? '—';
    const b = next?.[f] ?? '—';
    if (a !== b) diffs.push(`${f}: "${a}" → "${b}"`);
  }
  return diffs.length ? diffs.join('; ') : 'no changes';
};

const deepEqual = (a, b) => JSON.stringify(a || {}) === JSON.stringify(b || {});

// ----------------- Endpoint -----------------
app.http('cosmoUpdateAiClassification', {
  methods: ['PATCH', 'POST'],
  authLevel: 'anonymous',
  handler: withAuth(async (req, context) => {
    try {
      // 1) Claims y autorización
      const claims = context.user || {};
      const actor_email = getEmailFromClaims(claims);
      if (!actor_email) {
        return { status: 401, jsonBody: { error: 'Email not found in token' } };
      }

      const { role } = getRoleGroups(claims, {
        SUPERVISORS_GROUP: GROUP_CSERV_SUPERVISORS,
        AGENTS_GROUP: GROUP_CSERV_AGENTS,
      });
      if (!role || (role !== 'supervisor' && role !== 'agent')) {
        return { status: 403, jsonBody: { error: 'Insufficient permissions (agents/supervisors only)' } };
      }

      // 2) Body (validado con Joi externo)
      let body;
      try {
        body = await req.json();
      } catch {
        return badRequest('Invalid JSON body.');
      }

      const { error: vErr, value: input } = updateAiClassificationInput.validate(body, {
        abortEarly: false,
        stripUnknown: true,
      });
      if (vErr) {
        const details = vErr.details?.map(d => d.message).join('; ') || 'Invalid input';
        return badRequest(details);
      }

      const ticketId = input.ticketId;

      // merge parcial: objeto + campos sueltos
      const patchIn = sanitizeAi({
        ...(input.aiClassification || {}),
        ...(['priority','risk','category'].reduce((acc, k) => {
          if (input[k] !== undefined) acc[k] = input[k];
          return acc;
        }, {})),
      });
      if (Object.keys(patchIn).length === 0) {
        return badRequest('Nothing to update in aiClassification.');
      }

      // 3) Leer ticket actual
      const container = getContainer();
      const item = container.item(ticketId, ticketId);

      const { resource: existing } = await item.read();
      if (!existing) return notFound('Ticket not found.');

      const prevAI = existing.aiClassification || {};
      const nextAI = { ...prevAI, ...patchIn };

      // Si no hay cambios reales, devolver 200 sin patch
      if (deepEqual(prevAI, nextAI)) {
        const dto = validateAndFormatTicket(existing, badRequest, context, { strict: false });
        return success('No changes in aiClassification', dto, 200);
      }

      const { dateISO: miamiUTC } = getMiamiNow();
      const patchOps = [];

      if (!Array.isArray(existing.notes)) {
        patchOps.push({ op: 'add', path: '/notes', value: [] });
      }

      // upsert aiClassification
      patchOps.push({
        op: existing.aiClassification ? 'replace' : 'add',
        path: '/aiClassification',
        value: nextAI,
      });

      // nota de sistema
      patchOps.push({
        op: 'add',
        path: '/notes/-',
        value: {
          datetime: miamiUTC,
          event_type: 'system_log',
          agent_email: actor_email,
          event: `AI classification updated: ${buildChangeSummary(prevAI, nextAI)}`
        }
      });

      // 4) Patch + reread
      let sessionToken;
      try {
        const patchRes = await item.patch(patchOps);
        sessionToken = patchRes?.headers?.['x-ms-session-token'];
      } catch (e) {
        return error('Failed to update aiClassification', 500, e.message);
      }

      let updated;
      try {
        const readOpts = sessionToken ? { sessionToken } : { consistencyLevel: 'Strong' };
        const { resource } = await item.read(readOpts);
        updated = resource;
      } catch (e) {
        updated = { ...existing, aiClassification: nextAI }; // fallback
      }

      // 5) DTO salida
      let dto;
      try {
        dto = validateAndFormatTicket(updated, badRequest, context, { strict: false });
      } catch (badReq) {
        return badReq;
      }

      return success('AI classification updated', dto);
    } catch (err) {
      context.log('❌ Error updating aiClassification:', err);
      return error('Internal Server Error', 500, err?.message || 'Unknown');
    }
  }, {
    // ✔️ Token válido y acceso al módulo
    scopesAny: ['access_as_user'],
    groupsAny: [GROUP_CUSTOMER_SERVICE], // puerta de entrada al módulo Referrals
  })
});
