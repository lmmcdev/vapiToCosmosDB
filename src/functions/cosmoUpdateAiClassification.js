// functions/cosmoUpdateAiClassification/index.js (CommonJS)
const { app } = require('@azure/functions');
const { getContainer } = require('../shared/cosmoClient');
const { success, error, badRequest, notFound } = require('../shared/responseUtils');

// Auth utils
const { withAuth } = require('./auth/withAuth');
const { GROUPS } = require('./auth/groups.config');
const { getEmailFromClaims } = require('./auth/auth.helper');

// Hora Miami
const { getMiamiNow } = require('./helpers/timeHelper');

// DTO formatter tolerante
const { validateAndFormatTicket } = require('./helpers/outputDtoHelper');

// ✅ Schemas
const { updateAiClassificationInput } = require('./dtos/input.schema');

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
      // 1) Actor
      const claims = context.user || {};
      const actor_email = getEmailFromClaims(claims);
      if (!actor_email) {
        return { status: 401, jsonBody: { error: 'Email not found in token' } };
      }

      // 2) Body
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

      // merge parcial
      const patchIn = sanitizeAi({
        ...(input.aiClassification || {}),
        ...(['priority', 'risk', 'category'].reduce((acc, k) => {
          if (input[k] !== undefined) acc[k] = input[k];
          return acc;
        }, {})),
      });
      if (Object.keys(patchIn).length === 0) {
        return badRequest('Nothing to update in aiClassification.');
      }

      // 3) Leer ticket
      const container = getContainer();
      const item = container.item(ticketId, ticketId);

      const { resource: existing } = await item.read();
      if (!existing) return notFound('Ticket not found.');

      const prevAI = existing.aiClassification || {};
      const nextAI = { ...prevAI, ...patchIn };

      if (deepEqual(prevAI, nextAI)) {
        const dto = validateAndFormatTicket(existing, badRequest, context, { strict: false });
        return success('No changes in aiClassification', dto, 200);
      }

      const { dateISO: miamiUTC } = getMiamiNow();
      const patchOps = [];

      if (!Array.isArray(existing.notes)) {
        patchOps.push({ op: 'add', path: '/notes', value: [] });
      }

      patchOps.push({
        op: existing.aiClassification ? 'replace' : 'add',
        path: '/aiClassification',
        value: nextAI,
      });

      patchOps.push({
        op: 'add',
        path: '/notes/-',
        value: {
          datetime: miamiUTC,
          event_type: 'system_log',
          agent_email: actor_email,
          event: `AI classification updated: ${buildChangeSummary(prevAI, nextAI)}`,
        },
      });

      // 4) Patch + reread
      let updated;
      try {
        await item.patch(patchOps);
        const { resource } = await item.read();
        updated = resource;
      } catch (e) {
        context.log('⚠️ Patch failed, fallback to merged DTO:', e.message);
        updated = { ...existing, aiClassification: nextAI };
      }

      // 5) DTO salida
      const dto = validateAndFormatTicket(updated, badRequest, context, { strict: false });
      return success('AI classification updated', dto);
    } catch (err) {
      context.log('❌ Error updating aiClassification:', err);
      return error('Internal Server Error', 500, err?.message || 'Unknown');
    }
  }, {
    scopesAny: ['access_as_user'],
    // ✅ Todos los grupos (de todos los módulos) pueden acceder
    groupsAny: Object.values(GROUPS).flatMap(mod => Object.values(mod)),
  })
});
