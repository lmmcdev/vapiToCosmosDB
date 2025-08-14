const { app } = require('@azure/functions');
const { getAgentContainer } = require('../shared/cosmoAgentClient');
const { success, badRequest, error } = require('../shared/responseUtils');

app.http('cosmoGetAgents', {
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: async (req, context) => {
    try {
      const agentAssigned = req.query.get('agentAssigned'); // ✅ ahora viene por query param

      if (!agentAssigned) {
        return badRequest('Missing required parameter: agentAssigned');
      }

      const container = getAgentContainer();

      // ✅ Buscar agente para determinar su rol y departamento
      const { resources: agentResult } = await container.items
        .query({
          query: `
            SELECT c.id, c.agent_name, c.agent_email, c.agent_rol, 
                   c.agent_department, c.remote_agent, c.timestamp, 
                   c.agent_extension
            FROM c
            WHERE c.agent_email = @agentEmail OR c.id = @agentEmail
          `,
          parameters: [{ name: "@agentEmail", value: agentAssigned }]
        })
        .fetchAll();

      if (agentResult.length === 0) {
        return badRequest(`Agent ${agentAssigned} not found`);
      }

      const agent = agentResult[0];
      const { agent_rol, agent_department } = agent;

      let querySpec;

      // ✅ Lógica basada en el rol
      if (agent_rol.toLowerCase() === 'admin') {
        // Admin ve todos los agentes
        querySpec = {
          query: `
            SELECT c.id, c.agent_name, c.agent_email, c.agent_rol,
                   c.agent_department, c.remote_agent, c.timestamp,
                   c.agent_extension
            FROM c
          `
        };
      } else if (agent_rol.toLowerCase() === 'supervisor') {
        // Supervisor ve todos los agentes de su departamento
        querySpec = {
          query: `
            SELECT c.id, c.agent_name, c.agent_email, c.agent_rol,
                   c.agent_department, c.remote_agent, c.timestamp,
                   c.agent_extension
            FROM c
            WHERE c.agent_department = @dept
          `,
          parameters: [{ name: "@dept", value: agent_department }]
        };
      } else {
        // Rol agent: solo ve su propio registro
        querySpec = {
          query: `
            SELECT c.id, c.agent_name, c.agent_email, c.agent_rol,
                   c.agent_department, c.remote_agent, c.timestamp,
                   c.agent_extension
            FROM c
            WHERE c.agent_email = @agentEmail
          `,
          parameters: [{ name: "@agentEmail", value: agentAssigned }]
        };
      }

      const { resources: items } = await container.items.query(querySpec).fetchAll();
      return success({ role: agent_rol, department: agent_department, agents: items });

    } catch (err) {
      context.log('❌ Error fetching agents:', err);
      return error('Error fetching agents', err);
    }
  }
});
