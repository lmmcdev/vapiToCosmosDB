// src/functions/cosmoQualityUnified/index.js
// CommonJS - Azure Functions v4 (app.http)

const { app } = require('@azure/functions');

// Cosmos clients
const { getContainer }   = require('../shared/cosmoClient');          // tickets
const { getQAContainer } = require('../shared/cosmoQAClient');        // quality_control_tickets (lista de tickets en revisión)
const { getQCContainer } = require('../shared/cosmoQCEvaluations');   // qc_evaluations (métricas)

// Utils de respuesta
const { success, error, badRequest, notFound } = require('../shared/responseUtils');

// Helpers / DTO
const { validateAndFormatTicket } = require('./helpers/outputDtoHelper');
const { getMiamiNow } = require('./helpers/timeHelper');

// 🔐 Auth
const { withAuth } = require('./auth/withAuth');
const { GROUPS } = require('./auth/groups.config');
const { getEmailFromClaims } = require('./auth/auth.helper');

// Grupos (defensa en profundidad + withAuth.groupsAny)
const GROUP_QUALITY_REVIEWERS     = GROUPS?.QUALITY?.QUALITY_GROUP;
const GROUP_REFERRALS_SUPERVISORS = GROUPS?.REFERRALS?.SUPERVISORS_GROUP;

// ——— Helpers ———

// Sólo "in_review" debe quedar en el contenedor de revisión
const staysInQcList = (s) => s === 'in_review';

// Suma de rúbrica (0..15)
const computeScore = (rubric, fallback = 0) => {
  if (!rubric) return fallback;
  const keys = ['compliance','accuracy','process','softSkills','documentation'];
  return keys.map(k => Number(rubric?.[k] ?? 0)).reduce((a, b) => a + b, 0);
};

// Lee si el ticket ya está en quality_control_tickets
async function isInQcList(qcTickets, id, context) {
  try {
    const { resource } = await qcTickets.item(id, id).read();
    return !!resource;
  } catch (e) {
    // 404/NotFound ⇒ no está; otros errores los logueamos y tratamos como "no"
    if (e.code !== 404) context.log('⚠️ isInQcList read error:', e.message);
    return false;
  }
}

// ——— Endpoint unificado ———
app.http('cosmoUpsertQc', {
  methods: ['PATCH', 'POST'],
  authLevel: 'anonymous',
  handler: withAuth(async (req, context) => {
    try {
      // Tiempos Miami
      const { dateISO: miamiUTC } = getMiamiNow();
      const { dateISO: miamiISO } = getMiamiNow();

      // Actor
      const claims = context.user || {};
      const actor_email = getEmailFromClaims(claims);
      if (!actor_email) return { status: 401, jsonBody: { error: 'Email not found in token' } };

      // Autorización fina (Quality o Supervisors)
      const groups = Array.isArray(claims.groups) ? claims.groups : [];
      const isSupervisor = !!GROUP_REFERRALS_SUPERVISORS && groups.includes(GROUP_REFERRALS_SUPERVISORS);
      const isQuality    = !!GROUP_QUALITY_REVIEWERS     && groups.includes(GROUP_QUALITY_REVIEWERS);
      if (!isQuality && !isSupervisor) {
        return { status: 403, jsonBody: { error: 'Insufficient permissions for quality review.' } };
      }

      // Body (validación laxa para permitir status arbitrario como "done")
      let body;
      try { body = await req.json(); } catch { return badRequest('Invalid JSON body.'); }

      const { ticketId, status: statusIn, outcome, rubric } = body || {};
      if (!ticketId || typeof ticketId !== 'string' || ticketId.trim().length === 0) {
        return badRequest('Missing or invalid "ticketId".');
      }
      if (statusIn && typeof statusIn !== 'string') {
        return badRequest('"status" must be a string when provided.');
      }
      if (rubric) {
        const dims = ['compliance','accuracy','process','softSkills','documentation'];
        const invalidDim = dims.find(k => rubric[k] != null && isNaN(Number(rubric[k])));
        if (invalidDim) return badRequest(`"rubric.${invalidDim}" must be a number.`);
        if (rubric.comments != null && typeof rubric.comments !== 'string') {
          return badRequest('"rubric.comments" must be a string if provided.');
        }
      }

      // Leer ticket base
      const container = getContainer();
      const item = container.item(ticketId, ticketId);
      let existing;
      try {
        ({ resource: existing } = await item.read());
      } catch (e) {
        return error('Failed to read ticket.', 500, e.message);
      }
      if (!existing) return notFound('Ticket not found.');

      // Contenedor de lista de revisión
      const qcTickets = getQAContainer();

      // Estado actual de pertenencia
      const currentlyInList = await isInQcList(qcTickets, ticketId, context);

      // —— Resolver nextStatus + acción de pertenencia (insert/remove/nochange) —— //
      let nextStatus = null;
      /** @type {'insert'|'remove'|'nochange'} */
      let membershipAction = 'nochange';

      if (typeof statusIn === 'string') {
        // Regla 1: si viene status explícito, decide pertenencia
        nextStatus = statusIn;
        membershipAction = staysInQcList(statusIn) ? 'insert' : 'remove';
      } else if (typeof outcome === 'string') {
        // Regla 2: si no hay status, outcome decide algunos casos
        if (['passed', 'failed', 'coaching_required'].includes(outcome)) {
          nextStatus = outcome;           // terminales ⇒ remover
          membershipAction = 'remove';
        } else if (outcome === 'reviewing') {
          nextStatus = 'in_review';       // reviewing ⇒ insertar si no está (o upsert)
          membershipAction = 'insert';
        } else {
          // outcome no contemplado ⇒ sin cambio explícito de membresía
          nextStatus = existing?.qc?.status ?? 'in_review';
          membershipAction = 'nochange';
        }
      } else {
        // Regla 3: ni status ni outcome
        if (!currentlyInList) {
          // "llega sin status y no está en el contenedor" ⇒ insertar automáticamente
          nextStatus = 'in_review';
          membershipAction = 'insert';
        } else {
          // ya estaba; no forzamos cambio de pertenencia
          nextStatus = existing?.qc?.status ?? 'in_review';
          membershipAction = 'nochange';
        }
      }

      // Calcular score (si se proporciona rúbrica)
      const score = computeScore(rubric, typeof existing?.qc?.score === 'number' ? existing.qc.score : 0);

      // Entrada inmutable de historial
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

      // Resumen QC
      const qcSummary = {
        status: nextStatus,
        reviewer_email: actor_email,
        updatedAt: miamiISO,
        score,
      };

      // — Patch del ticket (sin tocar ticket.status principal) —
      const patchOps = [];

      // Asegura qc + history
      if (!existing.qc) {
        patchOps.push({ op: 'add', path: '/qc', value: { ...qcSummary, history: [] } });
      }

      const hasHistory = Array.isArray(existing?.qc?.history);
      if (!hasHistory) {
        if (existing?.qc && Object.keys(existing.qc).length > 0) {
          const legacySnapshot = {
            createdAt: existing.qc.updatedAt || miamiISO,
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

      // Nueva entrada de historial
      patchOps.push({ op: 'add', path: '/qc/history/-', value: evaluationEntry });

      // Campos de resumen
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

      // Nota de sistema
      if (!Array.isArray(existing.notes)) {
        patchOps.push({ op: 'add', path: '/notes', value: [] });
      }
      const autoMsg = (typeof statusIn !== 'string' && typeof outcome !== 'string')
        ? ' (auto-enrollment, missing status/outcome)'
        : '';
      const noteValue = {
        datetime: miamiUTC,
        event_type: 'system_log',
        agent_email: actor_email,
        event: rubric
          ? `QC ${nextStatus}. Score ${score}/15.${autoMsg}`
          : `QC status set to ${nextStatus}.${autoMsg}`,
      };
      patchOps.push({ op: 'add', path: '/notes/-', value: noteValue });

      // Flag booleano de conveniencia alineado a la acción de membresía
      let quality_control;
      if (membershipAction === 'insert') quality_control = true;
      else if (membershipAction === 'remove') quality_control = false;
      else quality_control = !!existing.quality_control;

      if (typeof existing.quality_control === 'undefined') {
        patchOps.push({ op: 'add', path: '/quality_control', value: quality_control });
      } else {
        patchOps.push({ op: 'replace', path: '/quality_control', value: quality_control });
      }

      // Ejecutar patch
      let sessionToken;
      try {
        const patchRes = await item.patch(patchOps);
        sessionToken = patchRes?.headers?.['x-ms-session-token'];
      } catch (e) {
        return error('Failed to upsert QC', 500, e.message);
      }

      // Releer con session token
      try {
        const readOpts = sessionToken ? { sessionToken } : { consistencyLevel: 'Strong' };
        ({ resource: existing } = await item.read(readOpts));
      } catch (e) {
        context.log('⚠️ Read after patch failed, fallback merge:', e.message);
      }

      // Fallback de merge en memoria (por si la reread falló)
      if (!existing.qc) {
        existing.qc = { ...qcSummary, history: [evaluationEntry] };
      } else {
        existing.qc = { ...existing.qc, ...qcSummary };
        if (!Array.isArray(existing.qc.history)) existing.qc.history = [];
        const dup = existing.qc.history.find(h =>
          h?.createdAt === evaluationEntry.createdAt &&
          h?.reviewer_email === evaluationEntry.reviewer_email &&
          h?.status === evaluationEntry.status &&
          (h?.score ?? null) === (evaluationEntry.score ?? null)
        );
        if (!dup) existing.qc.history = [...existing.qc.history, evaluationEntry];
      }

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

      // ——— Membership en quality_control_tickets según membershipAction ———
      if (membershipAction === 'insert') {
        try {
          await qcTickets.items.upsert({
            id: existing.id,
            ticketId: existing.id,
            agent_email: existing.agent_assigned || null,
            creation_date: existing.creation_date,
            patient_name: existing.patient_name,
            patient_dob: existing.patient_dob,
            callback_number: existing.callback_number,
            caller_id: existing.caller_id,
            call_cost: existing.call_cost,
            call_duration: existing.call_duration,
            status: existing.status,              // status "principal" del ticket (no lo tocamos aquí)
            agent_assigned: existing.agent_assigned,
            phone: existing.phone,
            aiClassification: existing.aiClassification,
            quality_control: true,
            linked_patient_snapshot: existing.linked_patient_snapshot,
            startDate: miamiUTC,
            qc_status: 'in_review',
          });
        } catch (e) {
          context.log('❗ Failed to upsert into quality_control_tickets:', e.message);
        }
      } else if (membershipAction === 'remove') {
        try {
          await qcTickets.item(existing.id, existing.id).delete();
        } catch (e) {
          // Es normal que no exista si nunca estuvo en revisión
          context.log('⚠️ QC list delete (ok si no existía):', e.message);
        }
      } // 'nochange' ⇒ no tocamos el contenedor

      // ——— Métricas (opcional) ———
      try {
        const evalContainer = getQCContainer(); // partitionKey: /reviewer_email
        await evalContainer.items.create({
          id: `${existing.id}_${miamiISO}`,
          ticketId: existing.id,
          createdAt: miamiISO,
          reviewer_email: actor_email,
          agent_email: existing.agent_assigned || null,
          status: nextStatus,
          outcome: outcome || null,
          score,
          rubric: evaluationEntry.rubric || null,
        }, { partitionKey: actor_email });
      } catch (err) {
        context.log('⚠️ Failed to insert qc_evaluations:', err.message);
      }

      // ——— Payload de salida + SignalR ———
      let dto;
      try {
        dto = validateAndFormatTicket(existing, badRequest, context);
      } catch (badReq) {
        return badReq;
      }

      const responseData = {
        id: existing.id,
        summary: existing.summary,
        call_reason: existing.call_reason,
        creation_date: existing.creation_date,
        patient_name: existing.patient_name,
        patient_dob: existing.patient_dob,
        caller_name: existing.caller_name,
        callback_number: existing.callback_number,
        caller_id: existing.caller_id,
        call_cost: existing.call_cost,
        notes: existing.notes,
        collaborators: existing.collaborators,
        url_audio: existing.url_audio,
        assigned_department: existing.assigned_department,
        assigned_role: existing.assigned_role,
        caller_type: existing.caller_type,
        call_duration: existing.call_duration,
        status: existing.status,         // principal
        agent_assigned: existing.agent_assigned,
        tiket_source: existing.tiket_source,
        phone: existing.phone,
        work_time: existing.work_time,
        aiClassification: existing.aiClassification,
        quality_control: existing.quality_control,
        qc: existing.qc,
        linked_patient_snapshot: existing.linked_patient_snapshot
      };

      return success('QC review saved', dto);

    } catch (e) {
      return error('Failed to upsert QC', 500, e?.message || 'Unknown');
    }
  }, {
    // 🔐 Gate principal (módulo QUALITY)
    scopesAny: ['access_as_user'],
    groupsAny: [GROUP_QUALITY_REVIEWERS, GROUP_REFERRALS_SUPERVISORS],
  })
});
