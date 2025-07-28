import { app } from '@azure/functions';
import crypto from 'crypto';

app.http('generateSasToken', {
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    const resourceUri = request.query.get('resourceUri');
    const keyName = request.query.get('keyName');
    const key = request.query.get('key');

    if (!resourceUri || !keyName || !key) {
      return {
        status: 400,
        jsonBody: {
          error: 'Missing required query params: resourceUri, keyName, key',
        },
      };
    }

    const expiry = Math.floor(Date.now() / 1000) + 3600; // Token válido por 1 hora
    const encodedUri = encodeURIComponent(resourceUri);
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
