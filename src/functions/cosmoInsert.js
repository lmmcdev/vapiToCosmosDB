const { app } = require('@azure/functions');
const crypto = require('crypto');
const { getContainer } = require('../shared/cosmoClient');

app.http('cosmoInsert', {
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    let body;
    try {
      body = await request.json();
    } catch (err) {
      context.log('Error al parsear JSON:', err);
      return { status: 400, body: 'Formato JSON inválido' };
    }

    const { nombre, correo } = body;
    if (!nombre || !correo) {
      return { status: 400, body: 'Faltan campos requeridos (nombre o correo)' };
    }

    try {
      const container = getContainer();

      const uniqueTicketId = `ticket-${crypto.randomUUID()}`;

      const item = {
        id: crypto.randomUUID(),
        name: nombre,
        email: correo,
        tickets: uniqueTicketId, // clave de partición dinámica
        timestamp: new Date().toISOString()
      };

      const { resource } = await container.items.create(item, {
        partitionKey: item.tickets
      });

      return { status: 201, body: `Item creado con ID: ${resource.id} y ticket: ${resource.tickets}` };
    } catch (error) {
      context.log('Error al insertar item:', error);
      return { status: 500, body: `Error del servidor: ${error.message}` };
    }
  }
});
