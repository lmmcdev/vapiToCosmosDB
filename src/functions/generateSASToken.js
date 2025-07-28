import { app } from '@azure/functions';
import crypto from 'crypto';

app.http('generateSasToken', {
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    const connectionString = request.query.get('connectionString');

    if (!connectionString) {
      return {
        status: 400,
        jsonBody: { error: 'Missing required parameter: connectionString' },
      };
    }

    // Parsear la connection string
    const parts = {};
    connectionString.split(';').forEach(part => {
      const [key, ...rest] = part.split('=');
      parts[key.toLowerCase()] = rest.join('=');
    });

    const endpoint = parts['endpoint']; // sb://.../
    const keyName = parts['sharedaccesskeyname'];
    const key = parts['sharedaccesskey'];

    if (!endpoint || !keyName || !key) {
      return {
        status: 400,
        jsonBody: { error: 'Invalid connection string format' },
      };
    }

    // Quitar el "sb://" y "/" final para formar el resourceUri
    const resourceUri = endpoint.replace(/^sb:\/\/|\/$/g, '') + '/cservicesnotificationhub1';

    const expiry = Math.floor(Date.now() / 1000) + 3600; // 1 hora
    const encodedUri = encodeURIComponent(resourceUri.toLowerCase());
    const stringToSign = `${encodedUri}\n${expiry}`;

    const hmac = crypto.createHmac('sha256', Buffer.from(key, 'base64'));
    hmac.update(stringToSign);
    const signature = hmac.digest('base64');

    const token = `SharedAccessSignature sr=${encodedUri}&sig=${encodeURIComponent(signature)}&se=${expiry}&skn=${keyName}`;

    return {
      status: 200,
      jsonBody: { token },
    };
  },
});
