const { app } = require('@azure/functions');
const crypto = require('crypto');
const { getContainer } = require('../shared/cosmoClient');

app.http('cosmoInsert', {
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    let body;

    // 1. Intentar parsear el cuerpo del request
    try {
      body = await request.json();
    } catch (err) {
      context.log('❌ Error al parsear JSON:', err);
      return { status: 400, body: 'Formato JSON inválido' };
    }

    // 2. Generar valores predeterminados
    const date = new Date();
    const ticketId = crypto.randomUUID();
    const status = "New";
    const agent_assigned = "";
    const tiket_source = "Phone";
    const collaborators = [];
    const notes = [{
      datetime: date.toISOString(),
      event_type: "system_log",
      event: "New ticket created"
    }];

    // 3. Extraer department desde message.phoneNumber.name
    let department = "Unknown";
    try {
      department = body.message.phoneNumber?.name || "Unknown";
    } catch (e) {
      context.log("⚠️ No se pudo extraer department desde messages.phoneNumber.name");
    }

    // 4. Combinar valores y construir el documento a insertar
    const itemToInsert = {
      ...body,
      tickets: ticketId,
      id: ticketId,
      status,
      agent_assigned,
      tiket_source,
      collaborators,
      notes,
      department,
      timestamp: new Date().toISOString()
    };

    try {
      const container = getContainer();

      const { resource } = await container.items.create(
        itemToInsert,
        { partitionKey: ticketId }
      );

      return {
        status: 201,
        body: {
          message: 'Item insertado correctamente',
          tickets: JSON.stringify(ticketId)
        }
      };

    } catch (error) {
      context.log('❌ Error al insertar en Cosmos DB:', error);
      return {
        status: 500,
        body: `Error al insertar en la base de datos: ${error.message}`
      };
    }
  }
});
