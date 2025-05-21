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
      const container = getContainer(); // Esto ya es el contenedor, no necesitas .database()

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
      context.log('Error al insertar item:', error);
      return { status: 500, body: `Error del servidor: ${error.message}` };
    }
  }
});
