const { app } = require('@azure/functions');
const { getContainer } = require('../shared/cosmoClient');
const { getAgentContainer } = require('../shared/cosmoAgentClient');
const { success, badRequest, notFound, error } = require('../shared/responseUtils');
const withAuth = require('../middlewares/authMiddleware');

const signalRUrl = process.env.SIGNAL_BROADCAST_URL2;
const signalRUrlStats = process.env.SIGNAL_BROADCAST_URL3;

const handler = async (context, req) => {
  let ticketId, newStatus, agent_email;

  try {
    ({ ticketId, newStatus, agent_email } = req.body); // usa req.body directamente
  } catch (err) {
    return badRequest('Invalid JSON.');
  }

  if (!ticketId || !newStatus || !agent_email) {
    return badRequest('Missing parameters: ticketId, newStatus or agent_email.');
  }

  const container = getContainer();
  const agentContainer = getAgentContainer();
  const item = container.item(ticketId, ticketId);

  try {
    const { resource: ticket } = await item.read();
    if (!ticket) return notFound('Ticket not found.');

    const query = {
      query: 'SELECT * FROM c WHERE c.agent_email = @agent_email',
      parameters: [{ name: '@agent_email', value: agent_email }]
    };

    const { resources: agents } = await agentContainer.items.query(query).fetchAll();
    if (!agents.length) return badRequest('Agent not found.');

    const agent = agents[0];
    const role = agent.agent_rol || 'Agent';

    const isAssigned = ticket.agent_assigned === agent_email;
    const isCollaborator = Array.isArray(ticket.collaborators) && ticket.collaborators.includes(agent_email);
    const isSupervisor = role === 'Supervisor';

    if (!isAssigned && !isCollaborator && !isSupervisor) {
      return badRequest('You do not have permission to change this ticket\'s status.');
    }

    if (ticket.status === newStatus) {
      return badRequest('New status is the same as the current one. No changes applied.');
    }

    const patchOps = [];

    if (!Array.isArray(ticket.notes)) {
      patchOps.push({ op: 'add', path: '/notes', value: [] });
    }

    patchOps.push({ op: 'replace', path: '/status', value: newStatus });

    patchOps.push({
      op: 'add',
      path: '/notes/-',
      value: {
        datetime: new Date().toISOString(),
        event_type: 'system_log',
        agent_email,
        event: `Status changed: "${ticket.status || 'Unknown'}" → "${newStatus}"`
      }
    });

    await item.patch(patchOps);

    const { resource: updated } = await item.read();

    const responseData = {
      ...updated
    };

    // Enviar actualización a SignalR
    try {
      await fetch(signalRUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(responseData)
      });
    } catch (e) {
      context.log('⚠️ SignalR failed:', e.message);
    }

    try {
      await fetch(signalRUrlStats, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(responseData)
      });
    } catch (e) {
      context.log('⚠️ SignalR failed stats:', e.message);
    }

    return success('Status updated successfully.', {
      applied_operations: patchOps.length
    });

  } catch (err) {
    context.log('❌ Error updating status:', err);
    return error('Internal Server Error', 500, err.message);
  }
};

app.http('cosmoUpdateStatus', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  handler: withAuth(handler), // middleware que valida el token
});
