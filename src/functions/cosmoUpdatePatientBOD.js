const { app } = require('@azure/functions');
const { getContainer } = require('../shared/cosmoClient');
const { getAgentContainer } = require('../shared/cosmoAgentClient');
const { success, badRequest, error, notFound } = require('../shared/responseUtils');

app.http('cosmoUpdatePatientBOD', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  handler: async (req, context) => {
    let tickets, agent_email, nueva_fechanacimiento;

    try {
      ({ tickets, agent_email, nueva_fechanacimiento } = await req.json());
    } catch (err) {
      return badRequest('Invalid JSON');
    }

    if (!tickets || !agent_email || !nueva_fechanacimiento) {
      return badRequest('Missing parameters: tickets, agent_email or nueva_fechanacimiento.');
    }

    const fechaRegex = /^(0[1-9]|1[0-2])\/(0[1-9]|[12]\d|3[01])\/\d{4}$/;
    if (!fechaRegex.test(nueva_fechanacimiento)) {
      return badRequest('Invalid date format. Use MM/DD/YYYY (e.g., 06/15/1985).');
    }

    const container = getContainer();
    const agentContainer = getAgentContainer();

    try {
      const item = container.item(tickets, tickets);
      const { resource: existing } = await item.read();

      if (!existing) return notFound('Ticket not found.');

      // Check permissions
      const query = {
        query: 'SELECT * FROM c WHERE c.agent_email = @agent_email',
        parameters: [{ name: '@agent_email', value: agent_email }]
      };
      const { resources: agents } = await agentContainer.items.query(query).fetchAll();
      if (!agents.length) return badRequest('Agent not found.');

      const agent = agents[0];
      const role = agent.agent_rol || 'Agent';

      const isAssigned = existing.agent_assigned === agent_email;
      const isCollaborator = Array.isArray(existing.collaborators) && existing.collaborators.includes(agent_email);
      const isSupervisor = role === 'Supervisor';

      if (!isAssigned && !isCollaborator && !isSupervisor) {
        return badRequest('You do not have permission to update the patient DOB.');
      }

      const patchOps = [];

      if (existing.patient_dob === undefined) {
        patchOps.push({
          op: 'add',
          path: '/patient_dob',
          value: nueva_fechanacimiento
        });
      } else {
        patchOps.push({
          op: 'replace',
          path: '/patient_dob',
          value: nueva_fechanacimiento
        });
      }

      if (!Array.isArray(existing.notes)) {
        patchOps.push({
          op: 'add',
          path: '/notes',
          value: []
        });
      }

      patchOps.push({
        op: 'add',
        path: '/notes/-',
        value: {
          datetime: new Date().toISOString(),
          event_type: 'system_log',
          agent_email,
          event: `Patient DOB changed to "${nueva_fechanacimiento}"`
        }
      });

      await item.patch(patchOps);

      return success('Patient DOB updated successfully.');

    } catch (err) {
      context.log('❌ Error updating patient DOB:', err);
      return error('Error updating patient DOB.', 500, err.message);
    }
  }
});
