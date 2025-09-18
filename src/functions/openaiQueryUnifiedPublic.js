const { app } = require('@azure/functions');
const { success, error, badRequest } = require('../shared/responseUtils');
const { queryOpenAIUnified } = require('./helpers/openaiHelper');
const { validateOpenAIUnifiedInput } = require('./dtos/openai.dto');

app.http('openaiQueryUnifiedPublic', {
  route: 'openai/query-unified',
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: async (req, context) => {
    try {
      context.log(`✅ Public unified OpenAI query request received`);

      // Obtener y validar el body de la request
      let body;
      try {
        body = await req.json();
      } catch (parseError) {
        return badRequest('Invalid JSON in request body');
      }

      // Validar entrada con DTO
      const { value: validatedInput, error: validationError } = validateOpenAIUnifiedInput(body);
      if (validationError) {
        const details = validationError.details?.map(d => d.message).join('; ') || 'Validation error';
        return badRequest(`Input validation failed: ${details}`);
      }

      const { systemPrompt, userContents, options = {} } = validatedInput;

      context.log(`🤖 Public unified OpenAI query - System prompt length: ${systemPrompt.length}, Contents count: ${userContents.length}`);

      // Realizar consulta unificada a OpenAI
      const result = await queryOpenAIUnified(systemPrompt, userContents, options);

      if (!result.success) {
        context.log(`❌ Public unified OpenAI query failed: ${result.error}`);
        return error('Unified OpenAI query failed', result.error);
      }

      // Log de éxito
      context.log(`✅ Public unified OpenAI query successful - Response type: ${typeof result.data}`);

      // Respuesta exitosa
      return success('Unified OpenAI query completed successfully', {
        result: result.data,
        metadata: {
          responseType: typeof result.data,
          usage: result.rawResponse?.usage,
          inputSummary: {
            contentsCount: userContents.length,
            averageContentLength: userContents.reduce((acc, item) => acc + item.content.length, 0) / userContents.length,
            totalCombinedLength: result.combinedContent?.length || 0
          },
          processedAt: new Date().toISOString()
        }
      });

    } catch (err) {
      context.log('❌ Error in public unified OpenAI query endpoint:', err);
      return error('Internal server error', err?.message || 'Unknown error');
    }
  }
});