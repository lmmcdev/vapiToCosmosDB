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
      return { status: 200, body: JSON.stringify(items) };
    } catch (error) {
      context.log('Error al consultar tickets:', error);
      return { status: 500, body: `Error: ${error.message}` };
    }
  }
});

/*const { app } = require('@azure/functions');
const { getContainer } = require('../shared/cosmoClient');

const endpoint = "https://lmmccosmos02.documents.azure.com:443/";
const key = "";

app.http('cosmoGet', {
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: async (_req, context) => {
    try {
    const database = client.database("IAData");
    const container = database.container("iadata_id");
    const { resources } = await container.items.query("SELECT * FROM c").fetchAll();
    console.log("Items:", resources);
  } catch (error) {
    console.error("Error de conexión:", error);
  }
  }
});*/