const { app } = require('@azure/functions');
const { success, error, badRequest } = require('../shared/responseUtils');
const { withAuth } = require('./auth/withAuth');
const { getEmailFromClaims } = require('./auth/auth.helper');
const { resolveUserDepartment } = require('./helpers/resolveDepartment');
const { GROUPS } = require('./auth/groups.config');
const { analyzeCallTranscription, extractBasicMetrics } = require('./helpers/callAnalysisHelper');

// Construir lista de TODOS los ACCESS_GROUP de cada departamento
const ALL_ACCESS_GROUPS = Object.values(GROUPS)
  .map((dept) => dept.ACCESS_GROUP)
  .filter(Boolean);

/**
 * Valida la entrada para análisis de llamadas
 * @param {object} body - Cuerpo de la request
 * @returns {object} - Resultado de validación
 */
function validateCallAnalysisInput(body) {
  if (!body || typeof body !== 'object') {
    return { error: { message: 'Request body must be an object' } };
  }

  const { transcription, options = {} } = body;

  if (!transcription || typeof transcription !== 'string') {
    return { error: { message: 'transcription is required and must be a string' } };
  }

  if (transcription.trim().length === 0) {
    return { error: { message: 'transcription cannot be empty' } };
  }

  // Validar opciones si se proporcionan
  if (options.temperature !== undefined && (typeof options.temperature !== 'number' || options.temperature < 0 || options.temperature > 2)) {
    return { error: { message: 'temperature must be a number between 0 and 2' } };
  }

  if (options.maxTokens !== undefined && (typeof options.maxTokens !== 'number' || options.maxTokens < 1)) {
    return { error: { message: 'maxTokens must be a positive number' } };
  }

  return { value: { transcription, options } };
}

app.http('analyzeCall', {
  route: 'analyze-call',
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: withAuth(
    async (req, context) => {
      try {
        const claims = context.user;
        const email = getEmailFromClaims(claims);
        
        if (!email) {
          return { status: 401, jsonBody: { error: 'Email not found in token' } };
        }

        // Resolver departamento del usuario
        const { location, role } = resolveUserDepartment(claims);
        if (!location || !role) {
          return { status: 403, jsonBody: { error: 'User has no valid location/role' } };
        }

        context.log(`✅ Call analysis request from user: ${email}, location: ${location}, role: ${role}`);

        // Obtener y validar el body de la request
        let body;
        try {
          body = await req.json();
        } catch (parseError) {
          return badRequest('Invalid JSON in request body');
        }

        // Validar entrada
        const { value: validatedInput, error: validationError } = validateCallAnalysisInput(body);
        if (validationError) {
          return badRequest(`Input validation failed: ${validationError.message}`);
        }

        const { transcription, options = {} } = validatedInput;

        context.log(`📞 Analyzing call - Transcription length: ${transcription.length} characters`);

        // Extraer métricas básicas primero
        const basicMetrics = extractBasicMetrics(transcription);
        context.log(`📊 Basic metrics - Turns: ${basicMetrics.total_turns}, Duration: ${basicMetrics.estimated_duration_minutes}min`);

        // Realizar análisis con OpenAI
        const analysisResult = await analyzeCallTranscription(transcription, options);

        if (!analysisResult.success) {
          context.log(`❌ Call analysis failed: ${analysisResult.error}`);
          return error('Call analysis failed', analysisResult.error);
        }

        context.log(`✅ Call analysis successful`);

        // Respuesta exitosa con métricas adicionales
        return success('Call analysis completed successfully', {
          analysis: analysisResult.data,
          basicMetrics,
          metadata: {
            userEmail: email,
            userLocation: location,
            userRole: role,
            transcriptionLength: transcription.length,
            estimatedCallDuration: basicMetrics.estimated_duration_minutes,
            usage: analysisResult.rawResponse?.usage
          }
        });

      } catch (err) {
        context.log('❌ Error in call analysis endpoint:', err);
        return error('Internal server error', err?.message || 'Unknown error');
      }
    },
    {
      scopesAny: ['access_as_user'],
      // Acceso permitido a todos los departamentos que tengan ACCESS_GROUP
      groupsAny: ALL_ACCESS_GROUPS,
    }
  ),
});

// Endpoint adicional para obtener solo métricas básicas (más rápido, sin OpenAI)
app.http('callMetrics', {
  route: 'call-metrics',
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: withAuth(
    async (req, context) => {
      try {
        const claims = context.user;
        const email = getEmailFromClaims(claims);
        
        if (!email) {
          return { status: 401, jsonBody: { error: 'Email not found in token' } };
        }

        const { location, role } = resolveUserDepartment(claims);
        if (!location || !role) {
          return { status: 403, jsonBody: { error: 'User has no valid location/role' } };
        }

        context.log(`✅ Call metrics request from user: ${email}`);

        let body;
        try {
          body = await req.json();
        } catch (parseError) {
          return badRequest('Invalid JSON in request body');
        }

        const { transcription } = body;
        if (!transcription || typeof transcription !== 'string') {
          return badRequest('transcription is required and must be a string');
        }

        const metrics = extractBasicMetrics(transcription);
        
        return success('Call metrics extracted successfully', {
          metrics,
          metadata: {
            userEmail: email,
            userLocation: location,
            userRole: role
          }
        });

      } catch (err) {
        context.log('❌ Error in call metrics endpoint:', err);
        return error('Internal server error', err?.message || 'Unknown error');
      }
    },
    {
      scopesAny: ['access_as_user'],
      groupsAny: ALL_ACCESS_GROUPS,
    }
  ),
});