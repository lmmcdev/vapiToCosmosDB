const { app } = require('@azure/functions');
const { getContainer } = require('../shared/cosmoClient');
const { success, badRequest, notFound, error } = require('../shared/responseUtils');

app.http('cosmoUpdateTicketDepartment', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  handler: async (req, context) => {
    const { ticketId, new_department, agent_email } = await req.json();

    if (!ticketId || !new_department || !agent_email) {
      return badRequest('Missing parameters: ticketId, new_department, or agent_email.');
    }

    try {
      const container = getContainer();
      const item = container.item(ticketId, ticketId);
      const { resource } = await item.read();

      if (!resource) return notFound('Ticket not found.');

      const previousDepartment = resource.assigned_department || 'Unassigned';

      await item.patch([
        { op: 'replace', path: '/assigned_department', value: new_department },
        { op: 'replace', path: '/agent_assigned', value: '' }, // 🔁 Limpia el campo
        {
          op: 'add',
          path: '/notes/-',
          value: {
            datetime: new Date().toISOString(),
            event_type: 'system_log',
            event: `Department changed from "${previousDepartment}" to "${new_department}" by ${agent_email}`
          }
        }
      ]);

      return success('Ticket department and assigned agent cleared successfully.');
    } catch (err) {
      context.log('❌ Error updating ticket:', err);
      return error('Error updating ticket department.', 500, err.message);
    }
  }
});
