// src/functions/cosmoUpdateCollaborators/index.js (CommonJS)
const { app } = require('@azure/functions');
const { getContainer } = require('../shared/cosmoClient');
const { success, error, badRequest, notFound } = require('../shared/responseUtils');
const { validateAndFormatTicket } = require('./helpers/outputDtoHelper');

// 🔐 Auth utils
const { withAuth } = require('./auth/withAuth');
const { getEmailFromClaims } = require('./auth/auth.helper');
const { resolveUserDepartment } = require('./helpers/resolveDepartment');
const { GROUPS } = require('./auth/groups.config');

const {
  ACCESS_GROUP: GROUP_SWITCHBOARD_ACCESS,
} = GROUPS.SWITCHBOARD;

const lc = (s) => (s || '').toLowerCase();

app.http('cosmoUpdateCollaborators', {
  route: 'cosmoUpdateCollaborators',
  methods: ['PATCH'],
  authLevel: 'anonymous',
  handler: withAuth(
    async (req, context) => {
      try {
        const claims = context.user;
        const actor_email = getEmailFromClaims(claims);
        if (!actor_email) {
          return { status: 401, jsonBody: { error: 'No email in token' } };
        }

        // 🔹 Resolver departamento dinámico y rol
        const { department, role } = resolveUserDepartment(claims);
        if (!department || !role) {
          return { status: 403, jsonBody: { error: 'User not authorized for any department' } };
        }

        let isSupervisor = false;
        if (role === "SUPERVISORS_GROUP") {
          isSupervisor = true;
        }

        console.log('User info:', { email: actor_email, department, role, isSupervisor });

        // 3) Parse body
        let body;
        try {
          body = await req.json();
        } catch {
          return badRequest('Invalid JSON body.');
        }

        const { ticketId, collaborators = [] } = body;
        if (!ticketId) return badRequest('ticketId is required');

        // 4) Buscar ticket
        const container = getContainer();
        const item = container.item(ticketId, ticketId);
        let existing;
        try {
          ({ resource: existing } = await item.read());
        } catch (e) {
          return error('Failed to read ticket.', 500, e.message);
        }
        if (!existing) return notFound('Ticket not found.');

        // 5) Autorización contextual: Supervisor, agente asignado o colaborador actual
        const isAssigned = lc(existing.agent_assigned) === lc(actor_email);
        const isCollaborator = Array.isArray(existing.collaborators) &&
          existing.collaborators.map(lc).includes(lc(actor_email));

        if (!isSupervisor && !isAssigned && !isCollaborator) {
          return { status: 403, jsonBody: { error: 'Insufficient permissions' } };
        }

        // 6) Normalizar lista
        const incomingClean = [...new Set(
          collaborators.map(e => lc(String(e).trim())).filter(Boolean)
        )];

        // No permitir que el agente asignado esté en colaboradores
        const assignedAgent = lc(existing.agent_assigned);
        if (assignedAgent && incomingClean.includes(assignedAgent)) {
          return badRequest(`Assigned agent (${assignedAgent}) cannot be a collaborator.`);
        }

        const current = Array.isArray(existing.collaborators)
          ? existing.collaborators.map(lc)
          : [];

        const removed = current.filter(e => !incomingClean.includes(e));
        const added = incomingClean.filter(e => !current.includes(e));

        if (!removed.length && !added.length) {
          return badRequest('No changes to collaborators.');
        }

        // 7) Patch
        const patchOps = [
          {
            op: Array.isArray(existing.collaborators) ? 'replace' : 'add',
            path: '/collaborators',
            value: incomingClean,
          },
          {
            op: 'add',
            path: '/notes/-',
            value: {
              datetime: new Date().toISOString(),
              event_type: 'system_log',
              agent_email: actor_email,
              event: `Updated collaborators. Added: ${added.join(', ') || 'None'}, Removed: ${removed.join(', ') || 'None'}`,
            },
          },
        ];

        try {
          await item.patch(patchOps);
          ({ resource: existing } = await item.read());
        } catch (e) {
          return error('Failed to update collaborators', 500, e.message);
        }

        // 8) DTO final
        const dto = validateAndFormatTicket(existing, badRequest, context);
        return success('Operation successful', dto);
      } catch (e) {
        return error('Failed to update collaborators', 500, e?.message || 'Unknown');
      }
    },
    {
      // 🔐 Acceso a nivel de endpoint → pueden entrar SWITCHBOARD y REFERRALS
      scopesAny: ['access_as_user'],
      groupsAny: [
        GROUPS.SWITCHBOARD.ACCESS_GROUP,
      ],
    }
  ),
});
