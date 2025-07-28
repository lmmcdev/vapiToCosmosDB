import { app } from '@azure/functions';
import crypto from 'crypto';

function generateSasToken(resourceUri, keyName, key) {
  const encodedResourceUri = encodeURIComponent(resourceUri);
  const expiry = Math.floor(Date.now() / 1000) + 3600; // 1 hora
  const stringToSign = `${encodedResourceUri}\n${expiry}`;
  const hmac = crypto.createHmac('sha256', key);
  hmac.update(stringToSign);
  const signature = encodeURIComponent(hmac.digest('base64'));

  const token = `SharedAccessSignature sr=${encodedResourceUri}&sig=${signature}&se=${expiry}&skn=${keyName}`;
  return token;
}

app.http('generateSasToken', {
  methods: ['POST'],
  authLevel: 'function',
  handler: async (request, context) => {
    const body = await request.json();

    const { resourceUri, keyName, key } = body;

    if (!resourceUri || !keyName || !key) {
      return {
        status: 400,
        body: { error: 'Missing one or more required fields: resourceUri, keyName, key' },
      };
    }

    try {
      const token = generateSasToken(resourceUri, keyName, key);
      return {
        status: 200,
        jsonBody: {
          token,
        },
      };
    } catch (err) {
      return {
        status: 500,
        jsonBody: {
          error: 'Failed to generate SAS token',
          details: err.message,
        },
      };
    }
  },
});
