const { app } = require('@azure/functions');
const { getContainer } = require('../shared/cosmoClient');

app.http('cosmoGet', {
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: async (_req, context) => {
    try {
      const container = getContainer();
      const query = {
        query: "SELECT * FROM c WHERE c.category = @category",
        parameters: [{ name: "@category", value: "tickets" }]
      };

      const { resources: items } = await container.items.query(query).fetchAll();
      return { status: 200, body: items };
    } catch (error) {
      context.log('Error al consultar tickets:', error);
      return { status: 500, body: `Error: ${error.message}` };
    }
  }
});