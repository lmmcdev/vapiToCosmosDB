// src/functions/searchProviders.js
const { app } = require('@azure/functions');
const { success, error, badRequest } = require('../shared/responseUtils');

const congnitiveURL = process.env.COGNITIVE_AI_URL;
const cognitiveKEY = process.env.COGNITIVE_AI_API_KEY;


app.http('searchProviders', {
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    let body;
    try {
      body = await request.json();
    } catch (err) {
      return badRequest('Invalid JSON', err.message);
    }

    const requiredFields = ['query'];

    const missingFields = requiredFields.filter(field => !body?.[field]);
    

    if (missingFields.length > 0) {
      return badRequest(`Missing required fields: ${missingFields.join(', ')}`);
    }

    const query = body.query
    if(query === '*') return badRequest(`Avoid this kind of search parameters`);

    //const searchEndpoint = 'https://cognitivesearchcservices.search.windows.net';
    //const apiKey = '';
    const indexName = 'providerscname-index';

    try {
      const response = await fetch(`${congnitiveURL}/indexes/${indexName}/docs?api-version=2023-10-01-Preview&search=${query}`,{
          method: 'GET',
          headers: { 'api-key': cognitiveKEY },
        });
        
        if (!response.ok) {
            throw new Error(`Search failed: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();

        return success('Search done', data, 201);
    } catch (err) {
      context.log(err.message);
      return error('DB Insert error', 500, err.message);
    }
  }
});
