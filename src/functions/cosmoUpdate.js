const { app } = require('@azure/functions');
const { getContainer } = require('../shared/cosmoClient');

app.http('updateTicket', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    const id = request.query.get("id");
    if (!id) {
      return { status: 400, body: "Falta el parámetro id" };
    }

    let updates;
    try {
      updates = await request.json();
    } catch {
      return { status: 400, body: "JSON inválido" };
    }

    try {
      const container = getContainer();

      // 1. Leer el documento
      const { resource: doc } = await container.item(id, id).read();

      if (!doc) {
        return { status: 404, body: "Ticket no encontrado" };
      }

      // 2. Aplicar los cambios
      Object.assign(doc, updates);

      // 3. Reemplazar el documento
      const { resource: updated } = await container.item(id, id).replace(doc);

      return {
        status: 200,
        body: updated
      };
    } catch (err) {
      context.log("Error al actualizar:", err);
      return {
        status: 500,
        body: `Error al actualizar: ${err.message}`
      };
    }
  }
});
