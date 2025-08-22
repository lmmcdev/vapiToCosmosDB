// CommonJS (Node/Functions v4 estilo app.http)
const { app } = require('@azure/functions');
const { getContainer } = require('../shared/cosmoClient');
const { success, error, badRequest, notFound } = require('../shared/responseUtils');
const { validateAndFormatTicket } = require('./helpers/outputDtoHelper');

// 🔐 Auth utils
const { withAuth } = require('./auth/withAuth');
const { GROUPS } = require('./auth/groups.config');
const { getEmailFromClaims } = require('./auth/auth.helper');
const { getMiamiNow } = require('./helpers/timeHelper')

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
      //date iso dates
      const { dateISO: miamiISO, dateDisplay: miamiDisplay } = getMiamiNow();
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

      // 5) Construir QC (resumen + historial)
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

      // Entrada de historial (inmutable)
      const evaluationEntry = {
        createdAt: miamiISO,
        reviewer_email: actor_email,
        status: nextStatus,
        ...(outcome ? { outcome } : {}),
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
        } : { score }),
      };

      // Resumen para lecturas rápidas
      const qcSummary = {
        status: nextStatus,
        reviewer_email: actor_email,
        updatedAt: miamiISO,
        score,
      };

      // 6) Patch: asegurar nodo qc, inicializar/migrar history y hacer append; agregar nota
      const patchOps = [];

      // Asegurar nodo /qc
      if (!existing.qc) {
        patchOps.push({ op: 'add', path: '/qc', value: { ...qcSummary, history: [] } });
      }

      // Migración desde formato legacy (qc sin history): sembrar snapshot
      const hasHistory = Array.isArray(existing?.qc?.history);
      if (!hasHistory) {
        if (existing?.qc && Object.keys(existing.qc).length > 0) {
          const legacyTsMs = existing?._ts ? existing._ts * 1000 : Date.now();
          const legacySnapshot = {
            createdAt: existing.qc.updatedAt || new Date(legacyTsMs).toISOString(),
            reviewer_email: existing.qc.reviewer_email || null,
            status: existing.qc.status || 'in_review',
            score: typeof existing.qc.score === 'number' ? existing.qc.score : 0,
            ...(existing.qc.rubric ? { rubric: existing.qc.rubric } : {}),
            migratedFromLegacy: true,
          };
          patchOps.push({ op: 'add', path: '/qc/history', value: [legacySnapshot] });
        } else {
          patchOps.push({ op: 'add', path: '/qc/history', value: [] });
        }
      }

      // Append nueva evaluación
      patchOps.push({ op: 'add', path: '/qc/history/-', value: evaluationEntry });

      // Actualizar resumen (sin tocar history)
      if (existing?.qc?.status !== undefined) {
        patchOps.push({ op: 'replace', path: '/qc/status', value: qcSummary.status });
      } else {
        patchOps.push({ op: 'add', path: '/qc/status', value: qcSummary.status });
      }

      if (existing?.qc?.reviewer_email !== undefined) {
        patchOps.push({ op: 'replace', path: '/qc/reviewer_email', value: qcSummary.reviewer_email });
      } else {
        patchOps.push({ op: 'add', path: '/qc/reviewer_email', value: qcSummary.reviewer_email });
      }

      if (typeof existing?.qc?.score === 'number') {
        patchOps.push({ op: 'replace', path: '/qc/score', value: qcSummary.score });
      } else {
        patchOps.push({ op: 'add', path: '/qc/score', value: qcSummary.score });
      }

      if (existing?.qc?.updatedAt !== undefined) {
        patchOps.push({ op: 'replace', path: '/qc/updatedAt', value: qcSummary.updatedAt });
      } else {
        patchOps.push({ op: 'add', path: '/qc/updatedAt', value: qcSummary.updatedAt });
      }

      // Asegurar /notes y agregar nota
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

      // Enviar patch
      let sessionToken;
      try {
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
        context.log('⚠️ Read after patch failed, will fallback merge for response:', e.message);
      }

      // 8) Fallback: asegurar que la respuesta **incluye** qc y la entrada de historial recién agregada
      if (!existing.qc) {
        existing.qc = { ...qcSummary, history: [evaluationEntry] };
      } else {
        // asegurar resumen actualizado
        existing.qc = { ...existing.qc, ...qcSummary };
        // asegurar history como array y que incluya la nueva entrada
        if (!Array.isArray(existing.qc.history)) existing.qc.history = [];
        const dup = existing.qc.history.find(e =>
          e?.createdAt === evaluationEntry.createdAt &&
          e?.reviewer_email === evaluationEntry.reviewer_email &&
          e?.status === evaluationEntry.status &&
          (e?.score ?? null) === (evaluationEntry.score ?? null)
        );
        if (!dup) existing.qc.history = [...existing.qc.history, evaluationEntry];
      }

      // Asegurar notes en la respuesta (sin duplicados obvios)
      if (!Array.isArray(existing.notes)) {
        existing.notes = [noteValue];
      } else {
        const dupNote = existing.notes.find(n =>
          n?.datetime === noteValue.datetime &&
          n?.agent_email === noteValue.agent_email &&
          n?.event === noteValue.event
        );
        if (!dupNote) existing.notes = [...existing.notes, noteValue];
      }

      // 9) Formatear salida (y asegurar qc también en dto)
      let dto;
      try {
        dto = validateAndFormatTicket(existing, badRequest, context);
      } catch (badReq) {
        return badReq;
      }
      if (!dto.qc) dto.qc = { ...qcSummary, history: [evaluationEntry] };

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
