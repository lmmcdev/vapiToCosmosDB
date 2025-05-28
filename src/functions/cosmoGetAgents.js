// src/functions/cosmoGet.js
const { app } = require('@azure/functions');
const { getContainer } = require('../shared/cosmoAgentClient');
const { success, error } = require('../shared/responseUtils');

app.http('cosmoGetAgents', {
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: async (req, context) => {
    try {
      const container = getContainer();

      const querySpec = {
        query: `
          SELECT c.id, c.agent_name,c.agent_email,c.agent_rol,c.agent_department,c.remote_agent,c.timestamp
          FROM c
        `
      };

      const { resources: items } = await container.items.query(querySpec).fetchAll();
      return success(items);

    } catch (err) {
      context.log('❌ Error al consultar agentes:', err);
      return error('Error al consultar agentes', err);
    }
  }
});
