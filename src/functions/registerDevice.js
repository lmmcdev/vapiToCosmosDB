
import { app } from '@azure/functions';
import { NotificationHubsClient, createBrowserInstallation, createFcmV1Installation } from "@azure/notification-hubs";

const connectionString = process.env.NOTIFICATION_HUB_CONNECTION || 'Endpoint=sb://cservicesnotificationhubs.servicebus.windows.net/;SharedAccessKeyName=cservicespolicy;SharedAccessKey=C6s7O7HRKnBsbS4WNdjYDKvwRGnofY0mGYjFXlJl6VQ=';
const hubName = process.env.NOTIFICATION_HUB_NAME || 'cservicesnotificationhub1';

const client = new NotificationHubsClient(connectionString, hubName);

app.http('registerDevice', {
  methods: ['POST'],
  authLevel: 'anonymous', // Cambia a 'function' si quieres protección con clave
  handler: async (request, context) => {
    try {
      const body = await request.json();

      const installationId = body.installationId;
      const pushChannel = body.pushChannel;
      const tags = body.tags || [];

      if (!installationId || !pushChannel) {
        return {
          status: 400,
          jsonBody: { error: 'installationId and pushChannel are required' },
        };
      }

      const installation = createBrowserInstallation({
        installationId,
        pushChannel,
        tags,
      });

      const result = await client.createOrUpdateInstallation(installation);

      return {
        status: 200,
        jsonBody: { message: 'Installation registered', result },
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
