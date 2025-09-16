/**
 * Agent Assignment Function
 *
 * This Azure Function handles the assignment of agents to tickets. When an agent
 * is assigned, the function:
 *
 * 1. Updates the Cosmos DB ticket with the new agent assignment
 * 2. Logs the assignment activity in the ticket's notes
 * 3. Sends real-time SignalR notifications to the assigned agent
 * 4. Sends Teams notifications to the assigned agent
 *
 * SignalR Integration:
 * - Uses the SIGNALR_SEND_TO_USERS environment variable for the SignalR endpoint
 * - Sends notifications to the 'ticketshubchannels' hub with 'agentAssignment' target
 * - Notifies the assigned agent with the complete updated ticket data
 * - Enables real-time updates in connected client applications
 *
 * Environment Variables Required:
 * - SIGNALR_SEND_TO_USERS: SignalR endpoint for sending user notifications
 *
 * @fileoverview src/functions/assignAgent/index.js (CommonJS)
 */

const fetch = require('node-fetch');
const { app } = require('@azure/functions');
const { getContainer } = require('../shared/cosmoClient');
const { success, badRequest, error } = require('../shared/responseUtils');
const { validateAndFormatTicket } = require('./helpers/outputDtoHelper');
const { getMiamiNow } = require('./helpers/timeHelper');

const signalRUrl = process.env.SIGNALR_SEND_TO_USERS;

const { withAuth } = require('./auth/withAuth');
const { GROUPS } = require('./auth/groups.config');
const { getEmailFromClaims, getRoleGroups } = require('./auth/auth.helper');

// DTO de entrada
const { assignAgentInput } = require('./dtos/input.schema');

// Teams notification helper
const { sendTeamsNotification } = require('./helpers/teamsNotificationHelper');

// 🔹 Construye lista de TODOS los grupos supervisores de todos los módulos
const ALL_SUPERVISORS = Object.values(GROUPS)
  .map(g => g?.SUPERVISORS_GROUP)
  .filter(Boolean);

app.http('assignAgent', {
  route: 'assignAgent',
  methods: ['PATCH'],
  authLevel: 'anonymous',
  handler: withAuth(
    async (request, context) => {
      try {
        const { dateISO: miamiUTC } = getMiamiNow();
        const claims = context.user;

        // 1) Email del actor
        const actor_email = getEmailFromClaims(claims);
        if (!actor_email) {
          return { status: 401, jsonBody: { error: 'Email not found in token' } };
        }

        // 2) Verificar que sea SUPERVISOR de al menos un módulo
        let isSupervisor = false;
        for (const supGroup of ALL_SUPERVISORS) {
          const { isSupervisor: check } = getRoleGroups(claims, {
            SUPERVISORS_GROUP: supGroup,
          });
          if (check) {
            isSupervisor = true;
            break;
          }
        }
        if (!isSupervisor) {
          return { status: 403, jsonBody: { error: 'Only supervisors can assign agents.' } };
        }

        // 3) Body
        let body;
        try {
          body = await request.json();
        } catch {
          return badRequest('Invalid JSON');
        }
        const { error: dtoErr, value } = assignAgentInput.validate(body, { abortEarly: false });
        if (dtoErr) {
          const details = dtoErr.details?.map(d => d.message).join('; ') || 'Validation error';
          return badRequest(details);
        }
        const { tickets: ticketId, target_agent_email } = value;

        // 4) Leer ticket
        const container = getContainer();
        const item = container.item(ticketId, ticketId);
        let existing;
        try {
          ({ resource: existing } = await item.read());
        } catch (e) {
          return error('Error reading ticket.', 500, e.message);
        }
        if (!existing) return badRequest('Ticket not found.');

        // 5) Construir patch
        const patchOps = [
          { op: 'replace', path: '/agent_assigned', value: target_agent_email },
        ];
        if (!Array.isArray(existing.notes)) {
          patchOps.push({ op: 'add', path: '/notes', value: [] });
        }
        patchOps.push({
          op: 'add',
          path: '/notes/-',
          value: {
            datetime: miamiUTC,
            event_type: 'system_log',
            agent_email: actor_email,
            event: `Assigned agent: ${target_agent_email}`,
          },
        });

        // 6) Aplicar patch y releer
        try {
          await item.patch(patchOps);
          ({ resource: existing } = await item.read());
        } catch (e) {
          return error('Error assigning agent.', 500, e.message);
        }

        // 7) Send SignalR notification to the assigned agent
        /**
         * SignalR Notification Step:
         * Sends real-time notification to the assigned agent through SignalR hub.
         * This enables immediate updates in connected client applications.
         *
         * Payload structure:
         * - hub: 'ticketshubchannels' - The SignalR hub name
         * - target: 'agentAssignment' - The client method to invoke
         * - userIds: Array of user emails to notify
         * - payload: Complete updated ticket data
         */
        try {
          if (signalRUrl) {
            const basePayload = {
              hub: 'ticketshubchannels',
              target: 'agentAssignment',
            };

            // Notify the assigned agent
            await fetch(signalRUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                ...basePayload,
                userIds: [target_agent_email],
                payload: existing, // ticket completo
              }),
            });
            context.log(`✅ SignalR notification sent successfully to ${target_agent_email}`);
          }
        } catch (e) {
          context.log('⚠️ SignalR notify failed:', e.message);
        }

        // 8) Send Teams notification to the assigned agent
        try {
          const notificationPayload = {
            user: target_agent_email,
            notification: `You have been assigned a new ticket: ${existing.summary || 'No summary available'}`,
            ticketId: ticketId,
            priority: 'normal',
            title: 'New Ticket Assignment',
            metadata: {
              source: 'agent-assignment',
              assignedBy: actor_email,
              ticketSummary: existing.summary?.substring(0, 100) || 'No summary',
              patientName: existing.patient_name || 'Unknown'
            }
          };

          context.log(`📧 Sending Teams notification to assigned agent: ${target_agent_email} for ticket: ${ticketId}`);
          await sendTeamsNotification(notificationPayload, context);
          context.log(`✅ Teams notification sent successfully to ${target_agent_email}`);
        } catch (notificationError) {
          // Log the error but don't fail the assignment operation
          context.log(`⚠️ Failed to send Teams notification to ${target_agent_email}:`, notificationError.message);
          // We continue execution since the assignment was successful
        }

        // 9) DTO
        const dto = validateAndFormatTicket(existing, badRequest, context);
        return success('Agent assigned successfully.', dto);
      } catch (e) {
        context.log('❌ assignAgent error:', e);
        return error('Unexpected error assigning agent.', 500, e?.message || 'Unknown');
      }
    },
    {
      // 🔐 Protecciones a nivel de endpoint
      scopesAny: ['access_as_user'],
      groupsAny: ALL_SUPERVISORS, // solo supervisores de cualquier módulo
    }
  ),
});
