// src/functions/cosmoUpdateCollaborators/index.js (CommonJS)
const { app } = require('@azure/functions');
const { getContainer } = require('../shared/cosmoClient');
const { success, error, badRequest, notFound } = require('../shared/responseUtils');
const { validateAndFormatTicket } = require('./helpers/outputDtoHelper');
const { withAuth } = require('./auth/withAuth');
const { getEmailFromClaims } = require('./auth/auth.helper');
const { resolveUserDepartment } = require('./helpers/resolveDepartment');
const { GROUPS } = require('./auth/groups.config');

const {
  ACCESS_GROUP: GROUP_SWITCHBOARD_ACCESS,
} = GROUPS.SWITCHBOARD;

const signalRUrl = process.env.SIGNALR_SEND_TO_USERS; // 👈 usamos el de users
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

        const { location, role } = resolveUserDepartment(claims);
        if (!location || !role) {
          return { status: 403, jsonBody: { error: 'User not authorized for any location' } };
        }

        let isSupervisor = role === "SUPERVISORS_GROUP";
        context.log('User info:', { email: actor_email, location, role, isSupervisor });

        // --- Parse body
        let body;
        try {
          body = await req.json();
        } catch {
          return badRequest('Invalid JSON body.');
        }

        const { ticketId, collaborators = [] } = body;
        if (!ticketId) return badRequest('ticketId is required');

        // --- Buscar ticket
        const container = getContainer();
        const item = container.item(ticketId, ticketId);
        let existing;
        try {
          ({ resource: existing } = await item.read());
        } catch (e) {
          return error('Failed to read ticket.', 500, e.message);
        }
        if (!existing) return notFound('Ticket not found.');

        // --- Permisos
        const isAssigned = lc(existing.agent_assigned) === lc(actor_email);
        const isCollaborator = Array.isArray(existing.collaborators) &&
          existing.collaborators.map(lc).includes(lc(actor_email));

        if (!isSupervisor && !isAssigned && !isCollaborator) {
          return { status: 403, jsonBody: { error: 'Insufficient permissions' } };
        }

        // --- Normalizar lista
        const incomingClean = [...new Set(
          collaborators.map(e => lc(String(e).trim())).filter(Boolean)
        )];

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

        // --- Patch
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

        // --- Notificar a TODOS los colaboradores via SignalR
        try {
          console.log(`Notifying SignalR for users: ${incomingClean.join(', ')}`);
          if (signalRUrl && Array.isArray(incomingClean) && incomingClean.length) {
            await fetch(signalRUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                hub: 'ticketshubchannels',
                userIds: incomingClean, // lista de correos / userId a notificar
                target: 'agentAssignment',
                payload: existing,
              }),
            });
          }
        } catch (e) {
          context.log('⚠️ SignalR notify failed:', e.message);
        }

        // --- DTO final
        const dto = validateAndFormatTicket(existing, badRequest, context);
        return success('Operation successful', dto);
      } catch (e) {
        return error('Failed to update collaborators', 500, e?.message || 'Unknown');
      }
    },
    {
      scopesAny: ['access_as_user'],
      groupsAny: [GROUP_SWITCHBOARD_ACCESS],
    }
  ),
});
