import { app } from '@azure/functions';
import {
  NotificationHubsClient,
  createBrowserInstallation
} from '@azure/notification-hubs';

const connectionString =
  process.env.NOTIFICATION_HUB_CONNECTION ||
  'Endpoint=sb://cservicesnotificationhubs.servicebus.windows.net/;SharedAccessKeyName=cservicespolicy;SharedAccessKey=C6s7O7HRKnBsbS4WNdjYDKvwRGnofY0mGYjFXlJl6VQ=';

const hubName =
  process.env.NOTIFICATION_HUB_NAME || 'cservicesnotificationhub1';

const client = new NotificationHubsClient(connectionString, hubName);

app.http('registerDevice', {
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    try {
      const subscription = await request.json();

      if (!subscription || !subscription.endpoint || !subscription.keys) {
        return {
          status: 400,
          jsonBody: { error: 'Invalid subscription object' },
        };
      }

      const installationId = subscription.keys.auth; // O puedes usar otro ID persistente del usuario
      const pushChannel = subscription.endpoint;

      const installation = createBrowserInstallation({
        installationId,
        pushChannel,
        tags: ['all'], // Puedes luego sustituir o extender esto
        expirationTime: null, // Opcional
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
      });

      await client.createOrUpdateInstallation(installation);

      return {
        status: 200,
        jsonBody: { message: 'Installation registered' },
      };
    } catch (error) {
      context.log('Error registering device:', error);
      return {
        status: 500,
        jsonBody: { error: error.message || 'Internal server error' },
      };
    }
  },
});