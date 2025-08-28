// src/functions/cosmoUpdateCollaborators/index.js (CommonJS)
const { app } = require('@azure/functions');

const { getContainer } = require('../shared/cosmoClient');
const { success, error, badRequest, notFound } = require('../shared/responseUtils');
const { validateAndFormatTicket } = require('./helpers/outputDtoHelper');

// 🔐 Auth utils
const { withAuth } = require('./auth/withAuth');
const { GROUPS } = require('./auth/groups.config');
const { getEmailFromClaims, getRoleGroups } = require('./auth/auth.helper');

// DTO de entrada (añádelo a ./dtos/input.schema.js y exporta updateTicketCollaboratorsInput)
const { updateTicketCollaboratorsInput } = require('./dtos/input.schema');

const {
  ACCESS_GROUP: GROUP_REFERRALS_ACCESS,
  SUPERVISORS_GROUP: GROUP_REFERRALS_SUPERVISORS,
  AGENTS_GROUP: GROUP_REFERRALS_AGENTS, // por si luego permites agentes
} = GROUPS.REFERRALS;

//const signalRUrl = process.env.SIGNAL_BROADCAST_URL2;


const lc = (s) => (s || '').toLowerCase();

app.http('cosmoUpdateCollaborators', {
  route: 'cosmoUpdateCollaborators',
  methods: ['PATCH'],
  authLevel: 'anonymous',
  handler: withAuth(async (req, context) => {
    try {
      // 1) Actor desde el token
      const claims = context.user;
      const actor_email = getEmailFromClaims(claims);
      if (!actor_email) {
        return { status: 401, jsonBody: { error: 'Email not found in token' } };
      }

      // 2) Rol efectivo (supervisor/agent) a partir de grupos
      const { role, isSupervisor, isAgent } = getRoleGroups(claims, {
        SUPERVISORS_GROUP: GROUP_REFERRALS_SUPERVISORS,
        AGENTS_GROUP: GROUP_REFERRALS_AGENTS,
      });
      if (!role) {
        return { status: 403, jsonBody: { error: 'User has no role group for this module' } };
      }

      // 3) Parse + valida entrada con DTO
      let body;
      try {
        body = await req.json();
      } catch {
        return badRequest('Invalid JSON body.');
      }

      const { error: vErr, value } = updateTicketCollaboratorsInput.validate(body, {
        abortEarly: false,
        stripUnknown: true,
      });
      if (vErr) {
        const details = vErr.details?.map(d => d.message).join('; ') || 'Invalid input.';
        return badRequest(details);
      }

      const { ticketId, collaborators = [] } = value;

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

      // 5) Autorización por contexto del ticket:
      //    - Supervisor, o
      //    - Agente asignado al ticket, o
      //    - Colaborador actual del ticket
      const isAssigned = lc(existing.agent_assigned) === lc(actor_email);
      const isCollaborator = Array.isArray(existing.collaborators)
        && existing.collaborators.map(lc).includes(lc(actor_email));

      if (!isSupervisor && !isAssigned && !isCollaborator) {
        return { status: 403, jsonBody: { error: 'Insufficient permissions to update collaborators.' } };
      }

      // 6) Normalizar lista entrante (lowercase + trim + únicos)
      const incomingClean = [...new Set(
        collaborators.map(e => lc(String(e).trim())).filter(Boolean)
      )];

      // 7) Regla de negocio: el agente asignado NO puede estar en colaboradores
      const assignedAgent = lc(existing.agent_assigned);
      if (assignedAgent && incomingClean.includes(assignedAgent)) {
        return badRequest(`Assigned agent (${assignedAgent}) cannot be a collaborator.`);
      }

      // Estado actual normalizado
      const current = Array.isArray(existing.collaborators)
        ? existing.collaborators.map(lc)
        : [];

      // 8) Determinar diferencias
      const removed = current.filter(e => !incomingClean.includes(e));
      const added = incomingClean.filter(e => !current.includes(e));

      if (removed.length === 0 && added.length === 0) {
        return badRequest('No changes to collaborators.');
      }

      // 9) Construir patchOps
      const patchOps = [];

      if (Array.isArray(existing.collaborators)) {
        patchOps.push({ op: 'replace', path: '/collaborators', value: incomingClean });
      } else {
        patchOps.push({ op: 'add', path: '/collaborators', value: incomingClean });
      }

      if (!Array.isArray(existing.notes)) {
        patchOps.push({ op: 'add', path: '/notes', value: [] });
      }

      patchOps.push({
        op: 'add',
        path: '/notes/-',
        value: {
          datetime: new Date().toISOString(),
          event_type: 'system_log',
          agent_email: actor_email,
          event: `Updated collaborators. Added: ${added.join(', ') || 'None'}, Removed: ${removed.join(', ') || 'None'}`,
        },
      });

      // 10) Aplicar patch y releer
      try {
        await item.patch(patchOps);
        ({ resource: existing } = await item.read());
      } catch (e) {
        return error('Failed to update collaborators', 500, e.message);
      }

      // 11) Formatear DTO de salida y notificar
      let dto;
      try {
        dto = validateAndFormatTicket(existing, badRequest, context);
      } catch (badReq) {
        return badReq;
      }

      //await notifySignalR(dto, context);

      // 12) Responder ticket completo
      return success('Operation successfull', dto);
    } catch (e) {
      return error('Failed to update collaborators', 500, e?.message || 'Unknown');
    }
  }, {
    // 🔐 Protecciones a nivel de endpoint
    scopesAny: ['access_as_user'],
    groupsAny: [GROUP_REFERRALS_ACCESS],
  })
});
