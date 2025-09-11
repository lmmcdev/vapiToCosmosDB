// src/functions/registerDevice/index.js (CommonJS)
const { app } = require('@azure/functions');
const {
  NotificationHubsClient,
  createBrowserInstallation,
  // createFcmV1Installation // si en algún momento usas FCM nativo
} = require('@azure/notification-hubs');

// Respuestas helper (opcional; si prefieres, puedes dejar returns “raw”)
const { success, badRequest, error } = require('../shared/responseUtils');

// Auth
const { withAuth } = require('./auth/withAuth');

// ⚠️ RECOMENDADO: usa solo variables de entorno en producción
const connectionString = process.env.NOTIFICATION_HUB_CONNECTION || 'Endpoint=sb://cservicesnotificationhubs.servicebus.windows.net/;SharedAccessKeyName=cservicespolicy;SharedAccessKey=C6s7O7HRKnBsbS4WNdjYDKvwRGnofY0mGYjFXlJl6VQ=';;
const hubName          = process.env.NOTIFICATION_HUB_NAME  || 'cservicesnotificationhub1';;

const client = new NotificationHubsClient(connectionString, hubName);

app.http('registerDevice', {
  route: 'registerDevice',
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: withAuth(async (request, context) => {
    try {
      let body;
      try {
        body = await request.json();
      } catch {
        return badRequest('Invalid JSON payload.');
      }

      const installationId = body?.installationId;
      const pushChannel    = body?.pushChannel;  // p256dh endpoint (Web Push)
      const userTags       = Array.isArray(body?.tags) ? body.tags : [];

      if (!installationId || !pushChannel) {
        return badRequest('installationId and pushChannel are required');
      }

      // Enriquecer tags con datos del usuario del token (útil para segmentar)
      const claims = context.user || {};
      const oid    = claims.oid || claims.sub || '';
      const email  = (claims.preferred_username || claims.email || '').toLowerCase();

      const tags = new Set(userTags);
      if (oid)   tags.add(`oid:${oid}`);
      if (email) tags.add(`email:${email}`);

      const installation = createBrowserInstallation({
        installationId,
        pushChannel,
        tags: Array.from(tags),
      });

      const result = await client.createOrUpdateInstallation(installation);

      return success('Installation registered', { result });
    } catch (err) {
      context.log('❌ Error registering device:', err);
      return error('Internal server error', 500, err?.message || 'Unknown error');
    }
  }, {
    // ✅ Cualquier usuario autenticado con el scope de la API puede registrar su dispositivo
    scopesAny: ['register_device'],
    // Sin restrictions de grupos -> todos los grupos pueden acceder
  }),
});