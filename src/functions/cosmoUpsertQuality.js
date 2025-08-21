// CommonJS (Node/Functions v4 estilo app.http)
const { app } = require('@azure/functions');
const { getContainer } = require('../shared/cosmoClient');
const { success, error, badRequest, notFound } = require('../shared/responseUtils');
const { validateAndFormatTicket } = require('./helpers/outputDtoHelper');

// 🔐 Auth utils
const { withAuth } = require('./auth/withAuth');
const { GROUPS } = require('./auth/groups.config');
const { getEmailFromClaims } = require('./auth/auth.helper');

// DTO
const { upsertQcInput } = require('./dtos/qc.dto');

// Helpers
const hasGroup = (claims, groupId) =>
  !!groupId && Array.isArray(claims?.groups) && claims.groups.includes(groupId);

const GROUP_QUALITY_REVIEWERS     = GROUPS?.QUALITY?.QUALITY_GROUP;
const GROUP_REFERRALS_SUPERVISORS = GROUPS?.REFERRALS?.SUPERVISORS_GROUP;

app.http('cosmoUpsertQuality', {
  route: 'cosmoUpsertQc',
  methods: ['PATCH', 'POST'],
  authLevel: 'anonymous',
  handler: withAuth(async (req, context) => {
    try {
      // 1) Actor
      const claims = context.user;
      const actor_email = getEmailFromClaims(claims);
      if (!actor_email) return { status: 401, jsonBody: { error: 'Email not found in token' } };

      // 2) Body
      let body;
      try { body = await req.json(); } catch { return badRequest('Invalid JSON body.'); }
      const { error: vErr, value: input } = upsertQcInput.validate(body, {
        abortEarly: false,
        stripUnknown: true,
      });
      if (vErr) {
        const details = vErr.details?.map(d => d.message).join('; ') || 'Invalid input.';
        return badRequest(details);
      }
      const { ticketId, rubric, outcome, status: statusIn } = input;

      // 3) Autorización fina
      const isSupervisor = hasGroup(claims, GROUP_REFERRALS_SUPERVISORS);
      const isQuality    = hasGroup(claims, GROUP_QUALITY_REVIEWERS);
      if (!isQuality && !isSupervisor) {
        return { status: 403, jsonBody: { error: 'Insufficient permissions for quality review.' } };
      }

      // 4) Leer ticket
      const container = getContainer();
      const item = container.item(ticketId, ticketId);
      let existing;
      try {
        ({ resource: existing } = await item.read());
      } catch (e) {
        return error('Failed to read ticket.', 500, e.message);
      }
      if (!existing) return notFound('Ticket not found.');

      // 5) Construir qc
      const ALLOWED_OUTCOMES = ['passed', 'failed', 'coaching_required'];
      const ALLOWED_STATUSES = ['pending', 'in_review', ...ALLOWED_OUTCOMES];

      let nextStatus = 'in_review';
      if (statusIn && ALLOWED_STATUSES.includes(statusIn)) nextStatus = statusIn;
      else if (outcome && ALLOWED_OUTCOMES.includes(outcome)) nextStatus = outcome;

      const nowIso = new Date().toISOString();
      const score = rubric
        ? ['compliance','accuracy','process','softSkills','documentation']
            .map(k => Number(rubric?.[k] || 0))
            .reduce((a, b) => a + b, 0)
        : (typeof existing?.qc?.score === 'number' ? existing.qc.score : 0);

      const qcValue = {
        ...(existing.qc || {}),
        status: nextStatus,
        reviewer_email: actor_email,
        updatedAt: nowIso,
        ...(rubric ? {
          rubric: {
            compliance:    rubric.compliance ?? 0,
            accuracy:      rubric.accuracy ?? 0,
            process:       rubric.process ?? 0,
            softSkills:    rubric.softSkills ?? 0,
            documentation: rubric.documentation ?? 0,
            comments:      rubric.comments ?? '',
          },
          score,
        } : {}),
      };

      // 6) Patch + nota
      const patchOps = [];
      if (existing.qc) {
        patchOps.push({ op: 'replace', path: '/qc', value: qcValue });
      } else {
        patchOps.push({ op: 'add', path: '/qc', value: qcValue });
      }
      if (!Array.isArray(existing.notes)) {
        patchOps.push({ op: 'add', path: '/notes', value: [] });
      }

      const noteValue = {
        datetime: nowIso,
        event_type: 'system_log',
        agent_email: actor_email,
        event: rubric
          ? `QC ${nextStatus}. Score ${score}/15.`
          : `QC status set to ${nextStatus}.`,
      };
      patchOps.push({ op: 'add', path: '/notes/-', value: noteValue });

      let sessionToken;
      try {
        // ⬇️ capturamos headers del patch para leer con el mismo token de sesión
        const patchRes = await item.patch(patchOps);
        sessionToken = patchRes?.headers?.['x-ms-session-token'];
      } catch (e) {
        return error('Failed to upsert QC', 500, e.message);
      }

      // 7) Releer usando Session Token (read-your-writes)
      try {
        const readOpts = sessionToken ? { sessionToken } : { consistencyLevel: 'Strong' };
        ({ resource: existing } = await item.read(readOpts));
      } catch (e) {
        // si falla la relectura, seguimos con fallback
        context.log('⚠️ Read after patch failed, will fallback merge for response:', e.message);
      }

      // 8) Fallback: asegurar que la respuesta **incluye** qc y nota recién agregada
      //    (en caso de que la relectura no refleje aún los cambios)
      if (!existing.qc) {
        existing.qc = qcValue;
      } else {
        // aseguramos que al menos el status/score más reciente está
        existing.qc = { ...existing.qc, ...qcValue };
      }
      if (!Array.isArray(existing.notes)) {
        existing.notes = [noteValue];
      } else {
        // Evitar duplicar (heurística por timestamp/agent/event)
        const dup = existing.notes.find(n =>
          n?.datetime === noteValue.datetime &&
          n?.agent_email === noteValue.agent_email &&
          n?.event === noteValue.event
        );
        if (!dup) existing.notes = [...existing.notes, noteValue];
      }

      // 9) Formatear salida (y asegurar qc también en dto)
      let dto;
      try {
        dto = validateAndFormatTicket(existing, badRequest, context);
      } catch (badReq) {
        return badReq;
      }
      if (!dto.qc) dto.qc = qcValue; // cinturón y tirantes

      return success('QC review saved', dto);
    } catch (e) {
      return error('Failed to upsert QC', 500, e?.message || 'Unknown');
    }
  }, {
    // 🔐 Puerta de entrada (módulo QUALITY)
    scopesAny: ['access_as_user'],
    groupsAny: [GROUP_QUALITY_REVIEWERS],
  }),
});
