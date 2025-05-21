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

    // 2. Generar UUID único para la partición 'tickets'
    const ticketId = crypto.randomUUID();

    // 3. Combinar ticket UUID al documento recibido
    const itemToInsert = {
      ...body,
      tickets: ticketId, // Usamos esta clave como partition key
      timestamp: new Date().toISOString()
    };

    try {
      const container = getContainer();

      // 4. Insertar en Cosmos DB usando la clave de partición correcta
      const { resource } = await container.items.create(
        itemToInsert,
        { partitionKey: ticketId } // 🔑 importante: este debe coincidir con `tickets`
      );

      // 5. Respuesta de éxito
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
