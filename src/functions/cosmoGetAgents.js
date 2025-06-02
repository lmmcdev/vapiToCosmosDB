const { app } = require('@azure/functions');
const { getAgentContainer } = require('../shared/cosmoAgentClient');
const { success, error } = require('../shared/responseUtils');

app.http('cosmoGetAgents', {
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: async (req, context) => {
    try {
      const assignedDepartment = req.query.get('assigned_department');
      const container = getAgentContainer();

      let querySpec;

      if (assignedDepartment) {
        querySpec = {
          query: `
            SELECT c.id, c.agent_name, c.agent_email, c.agent_rol,
                   c.agent_department, c.remote_agent, c.timestamp
            FROM c
            WHERE c.agent_department = @dept
          `,
          parameters: [{ name: "@dept", value: assignedDepartment }]
        };
      } else {
        querySpec = {
          query: `
            SELECT c.id, c.agent_name, c.agent_email, c.agent_rol,
                   c.agent_department, c.remote_agent, c.timestamp
            FROM c
          `
        };
      }

      const { resources: items } = await container.items.query(querySpec).fetchAll();
      return success(items);

    } catch (err) {
      context.log('❌ Error al consultar agentes:', err);
      return error('Error al consultar agentes', err);
    }
  }
});
