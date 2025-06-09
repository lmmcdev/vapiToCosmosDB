const { app } = require('@azure/functions');
const { getContainer } = require('../shared/cosmoClient');
const { getAgentContainer } = require('../shared/cosmoAgentClient');
const { success, badRequest, notFound, error } = require('../shared/responseUtils');

app.http('cosmoUpdateNotes', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  handler: async (req, context) => {
    let ticketId, notes, agent_email, event;

    try {
      ({ ticketId, notes, agent_email, event } = await req.json());
    } catch (err) {
      return badRequest('Invalid JSON.');
    }

    if (!ticketId || !agent_email) {
      return badRequest('Missing parameters: ticketId or agent_email.');
    }

    if (!Array.isArray(notes) && !event) {
      return badRequest('Missing notes array or event.');
    }

    if (Array.isArray(notes)) {
      for (const [i, note] of notes.entries()) {
        if (
          typeof note !== 'object' ||
          !note.agent_email ||
          typeof note.agent_email !== 'string'
        ) {
          return badRequest(`Note at index ${i} is missing a valid 'agent_email'.`);
        }
      }
    }

    const ticketContainer = getContainer();
    const agentContainer = getAgentContainer();
    const ticketItem = ticketContainer.item(ticketId, ticketId);

    try {
      const { resource: ticket } = await ticketItem.read();
      if (!ticket) return notFound('Ticket not found.');

      // Fetch agent info
      const query = {
        query: 'SELECT * FROM c WHERE c.agent_email = @agent_email',
        parameters: [{ name: '@agent_email', value: agent_email }]
      };
      const { resources: agents } = await agentContainer.items.query(query).fetchAll();
      if (!agents.length) return badRequest('Agent not found.');

      const agent = agents[0];
      const role = agent.agent_role || 'Agent';

      const isAssigned = ticket.agent_assigned === agent_email;
      const isCollaborator = Array.isArray(ticket.collaborators) && ticket.collaborators.includes(agent_email);
      const isSupervisor = role === 'Supervisor';

      if (!isAssigned && !isCollaborator && !isSupervisor) {
        return badRequest('You do not have permission to update notes on this ticket.');
      }

      const patchOps = [];

      if (!Array.isArray(ticket.notes)) {
        patchOps.push({ op: 'add', path: '/notes', value: [] });
      }

      if (Array.isArray(notes) && notes.length > 0) {
        for (const note of notes) {
          patchOps.push({
            op: 'add',
            path: '/notes/-',
            value: {
              ...note,
              datetime: note.datetime || new Date().toISOString(),
              event_type: note.event_type || 'user_log'
            }
          });
        }

        patchOps.push({
          op: 'add',
          path: '/notes/-',
          value: {
            datetime: new Date().toISOString(),
            event_type: 'system_log',
            agent_email,
            event: `Added ${notes.length} note(s) to the ticket.`
          }
        });
      }

      if (event) {
        patchOps.push({
          op: 'add',
          path: '/notes/-',
          value: {
            datetime: new Date().toISOString(),
            event_type: 'system_log',
            agent_email,
            event
          }
        });
      }

      if (patchOps.length === 0) {
        return badRequest('No valid operations to apply.');
      }

      await ticketItem.patch(patchOps);

      return success('Notes updated successfully.', {
        applied_operations: patchOps.length
      });

    } catch (err) {
      context.log('❌ Error updating notes:', err);
      return error('Internal Server Error', 500, err.message);
    }
  }
});
