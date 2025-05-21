const { app } = require('@azure/functions');
const crypto = require('crypto');
const { getContainer } = require('../shared/cosmoClient');

app.http('vapiToCosmo', {
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    let body;
    try {
      body = await request.json();
    } catch (err) {
      return { status: 400, body: 'Invalid JSON format' };
    }

    const { nombre, correo } = body;
    if (!nombre || !correo) {
      return { status: 400, body: 'Faltan campos requeridos' };
    }

    try {
      const container = getContainer();
      const item = {
        id: crypto.randomUUID(),
        name: nombre,
        email: correo,
        category: "tickets",
        timestamp: new Date().toISOString()
      };

      const { resource } = await container.items.create(item);
      return { status: 201, body: `Item creado con ID: ${resource.id}` };
    } catch (error) {
      context.log('Error:', error);
      return { status: 500, body: `Error: ${error.message}` };
    }
  }
});