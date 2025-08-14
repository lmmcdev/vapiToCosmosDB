// src/functions/negotiate/index.js (CommonJS)
const { app } = require('@azure/functions');

// Auth
const { withAuth } = require('./auth/withAuth');

app.http('negotiate', {
  route: 'negotiate',
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: withAuth(async (request, context) => {
    // El binding de SignalRConnectionInfo se inyecta abajo vía extraInputs
    const connectionInfo = context.bindings.signalRConnectionInfo;

    if (!connectionInfo) {
      return {
        status: 500,
        jsonBody: { error: 'Failed to get SignalR connection info' },
      };
    }

    // Devuelve el objeto tal cual lo requiere el cliente de SignalR
    return {
      status: 200,
      jsonBody: connectionInfo,
    };
  }, {
    // ✅ Cualquier usuario autenticado con el scope de la API puede negociar conexión
    scopesAny: ['access_as_user'],
    // No ponemos groupsAny para permitir a todos los grupos
  }),
  extraInputs: [
    {
      type: 'signalRConnectionInfo',
      name: 'signalRConnectionInfo',
      hubName: 'ticketsHub',
      // Opcional: si tu setting de conexión no es el default,
      // añade: connection: 'AzureSignalRConnectionString'
      // Opcional (si quieres asociar userId desde el token):
      // userId: "{headers.x-ms-client-principal-id}"  // o construye tu propio valor
    },
  ],
});
