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

// ====== Grupos del módulo QUALITY ======
const GROUP_QUALITY_REVIEWERS     = GROUPS?.QUALITY?.QUALITY_GROUP;             // único grupo QC definido
const GROUP_REFERRALS_SUPERVISORS = GROUPS?.REFERRALS?.SUPERVISORS_GROUP;       // opcional: dar pase a supervisores del módulo Referrals


app.http('cosmoUpsertQuality', {
  route: 'cosmoUpsertQc',
  methods: ['PATCH', 'POST'],
  authLevel: 'anonymous',
  handler: withAuth(async (req, context) => {
    try {
      // 1) Actor desde el token
      const claims = context.user;
      const actor_email = getEmailFromClaims(claims);
      if (!actor_email) return { status: 401, jsonBody: { error: 'Email not found in token' } };

      // 2) Validación de body
      let body;
      try {
        body = await req.json();
      } catch {
        return badRequest('Invalid JSON body.');
      }
      const { error: vErr, value: input } = upsertQcInput.validate(body, {
        abortEarly: false,
        stripUnknown: true,
      });
      if (vErr) {
        const details = vErr.details?.map(d => d.message).join('; ') || 'Invalid input.';
        return badRequest(details);
      }

      const { ticketId, rubric, outcome, status: statusIn } = input;

      // 3) Autorización fina (además del ACCESS_GROUP exigido por withAuth)
      const isSupervisor = hasGroup(claims, GROUP_REFERRALS_SUPERVISORS); // opcional
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

      // 5) Determinar estado/resultado QC
      const ALLOWED_OUTCOMES = ['passed', 'failed', 'coaching_required'];
      const ALLOWED_STATUSES = ['pending', 'in_review', ...ALLOWED_OUTCOMES];

      let nextStatus = 'in_review';
      if (statusIn && ALLOWED_STATUSES.includes(statusIn)) {
        nextStatus = statusIn;
      } else if (outcome && ALLOWED_OUTCOMES.includes(outcome)) {
        nextStatus = outcome;
      }

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
      patchOps.push({
        op: 'add',
        path: '/notes/-',
        value: {
          datetime: nowIso,
          event_type: 'system_log',
          agent_email: actor_email,
          event: rubric
            ? `QC ${nextStatus}. Score ${score}/15.`
            : `QC status set to ${nextStatus}.`,
        },
      });

      try {
        await item.patch(patchOps);
        ({ resource: existing } = await item.read({ consistencyLevel: 'Strong' }));
      } catch (e) {
        return error('Failed to upsert QC', 500, e.message);
      }

      // 7) DTO salida
      let dto;
      try {
        dto = validateAndFormatTicket(existing, badRequest, context);
      } catch (badReq) {
        return badReq;
      }

      return success('QC review saved', dto);
    } catch (e) {
      return error('Failed to upsert QC', 500, e?.message || 'Unknown');
    }
  }, {
    // 🔐 Protecciones a nivel de endpoint (puerta de entrada del módulo QC)
    scopesAny: ['access_as_user'],
    groupsAny: [GROUP_QUALITY_REVIEWERS], // exige pertenecer al módulo QUALITY
  }),
});
