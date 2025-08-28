// src/functions/cosmoUpdateCollaborators/index.js (CommonJS)
const { app } = require('@azure/functions');

const { getContainer } = require('../shared/cosmoClient');
const { success, error, badRequest, notFound } = require('../shared/responseUtils');
const { validateAndFormatTicket } = require('./helpers/outputDtoHelper');

// 🔐 Auth utils
const { withAuth } = require('./auth/withAuth');
const { getEmailFromClaims } = require('./auth/auth.helper');
const { resolveUserDepartment } = require('./helpers/resolveDepartment');

// DTO de entrada
const { updateTicketCollaboratorsInput } = require('./dtos/input.schema');

const lc = (s) => (s || '').toLowerCase();

app.http(
  'cosmoUpdateCollaborators',
  {
    route: 'cosmoUpdateCollaborators',
    methods: ['PATCH'],
    authLevel: 'anonymous',
    handler: withAuth(
      async (req, context) => {
        try {
          // 1) Actor desde el token
          const claims = context.user;
          const actor_email = getEmailFromClaims(claims);
          if (!actor_email) {
            return { status: 401, jsonBody: { error: 'Email not found in token' } };
          }

          // 2) Resolver dinámicamente departamento y rol
          const { department, role } = resolveUserDepartment(claims);
          if (!department || !role) {
            return {
              status: 403,
              jsonBody: { error: 'User has no valid role in any department' },
            };
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
            const details =
              vErr.details?.map((d) => d.message).join('; ') || 'Invalid input.';
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

          // 5) Autorización contextual:
          //    - Supervisores del depto
          //    - Agente asignado
          //    - Colaboradores actuales
          const isSupervisor = role.toLowerCase().includes('supervisor');
          const isAssigned = lc(existing.agent_assigned) === lc(actor_email);
          const isCollaborator =
            Array.isArray(existing.collaborators) &&
            existing.collaborators.map(lc).includes(lc(actor_email));

          if (!isSupervisor && !isAssigned && !isCollaborator) {
            return {
              status: 403,
              jsonBody: {
                error: 'Insufficient permissions to update collaborators.',
              },
            };
          }

          // 6) Normalizar lista entrante
          const incomingClean = [
            ...new Set(
              collaborators.map((e) => lc(String(e).trim())).filter(Boolean)
            ),
          ];

          // 7) Regla: assignedAgent no puede estar en colaboradores
          const assignedAgent = lc(existing.agent_assigned);
          if (assignedAgent && incomingClean.includes(assignedAgent)) {
            return badRequest(
              `Assigned agent (${assignedAgent}) cannot be a collaborator.`
            );
          }

          const current = Array.isArray(existing.collaborators)
            ? existing.collaborators.map(lc)
            : [];

          // 8) Determinar diferencias
          const removed = current.filter((e) => !incomingClean.includes(e));
          const added = incomingClean.filter((e) => !current.includes(e));

          if (removed.length === 0 && added.length === 0) {
            return badRequest('No changes to collaborators.');
          }

          // 9) PatchOps
          const patchOps = [];

          if (Array.isArray(existing.collaborators)) {
            patchOps.push({
              op: 'replace',
              path: '/collaborators',
              value: incomingClean,
            });
          } else {
            patchOps.push({
              op: 'add',
              path: '/collaborators',
              value: incomingClean,
            });
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
              event: `Updated collaborators. Added: ${
                added.join(', ') || 'None'
              }, Removed: ${removed.join(', ') || 'None'}`,
            },
          });

          // 10) Aplicar patch
          try {
            await item.patch(patchOps);
            ({ resource: existing } = await item.read());
          } catch (e) {
            return error('Failed to update collaborators', 500, e.message);
          }

          // 11) DTO de salida
          let dto;
          try {
            dto = validateAndFormatTicket(existing, badRequest, context);
          } catch (badReq) {
            return badReq;
          }

          return success('Operation successful', dto);
        } catch (e) {
          return error(
            'Failed to update collaborators',
            500,
            e?.message || 'Unknown'
          );
        }
      },
      {
        // Scopes básicos (lo fino se controla en el cuerpo con resolveUserDepartment)
        scopesAny: ['access_as_user'],
        // aquí podrías chequear sólo que pertenezca a algún grupo del sistema:
        groupsAny: Object.values(GROUPS).flatMap((g) => Object.values(g)),
      }
    ),
  }
);
