const { app } = require('@azure/functions');
const { success, error, badRequest } = require('../shared/responseUtils');
const { withAuth } = require('./auth/withAuth');
const { getEmailFromClaims } = require('./auth/auth.helper');
const { resolveUserDepartment } = require('./helpers/resolveDepartment');
const { GROUPS } = require('./auth/groups.config');
const { queryOpenAI, classifyTicket } = require('./helpers/openaiHelper');
const { 
  validateOpenAIInput, 
  validateTicketClassificationInput,
  validateTicketClassificationOutput 
} = require('./dtos/openai.dto');

// Construir lista de TODOS los ACCESS_GROUP de cada departamento
const ALL_ACCESS_GROUPS = Object.values(GROUPS)
  .map((dept) => dept.ACCESS_GROUP)
  .filter(Boolean);

app.http('openaiQuery', {
  route: 'openai/query',
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

        context.log(`✅ OpenAI query from user: ${email}, location: ${location}, role: ${role}`);

        // Obtener y validar el body de la request
        let body;
        try {
          body = await req.json();
        } catch (parseError) {
          return badRequest('Invalid JSON in request body');
        }

        // Validar entrada con DTO
        const { value: validatedInput, error: validationError } = validateOpenAIInput(body);
        if (validationError) {
          const details = validationError.details?.map(d => d.message).join('; ') || 'Validation error';
          return badRequest(`Input validation failed: ${details}`);
        }

        const { systemPrompt, userContent, options = {} } = validatedInput;

        // Log para auditoría (sin incluir contenido completo por seguridad)
        context.log(`🤖 OpenAI query - System prompt length: ${systemPrompt.length}, User content length: ${userContent.length}`);

        // Realizar consulta a OpenAI
        const result = await queryOpenAI(systemPrompt, userContent, options);

        if (!result.success) {
          context.log(`❌ OpenAI query failed: ${result.error}`);
          return error('OpenAI query failed', result.error);
        }

        // Log de éxito
        context.log(`✅ OpenAI query successful - Response type: ${typeof result.data}`);

        // Respuesta exitosa
        return success('OpenAI query completed successfully', {
          result: result.data,
          metadata: {
            userEmail: email,
            userLocation: location,
            userRole: role,
            responseType: typeof result.data,
            usage: result.rawResponse?.usage
          }
        });

      } catch (err) {
        context.log('❌ Error in OpenAI query endpoint:', err);
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

// Endpoint específico para clasificación de tickets
app.http('openaiClassifyTicket', {
  route: 'openai/classify-ticket',
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

        context.log(`✅ Ticket classification request from user: ${email}, location: ${location}, role: ${role}`);

        // Obtener y validar el body de la request
        let body;
        try {
          body = await req.json();
        } catch (parseError) {
          return badRequest('Invalid JSON in request body');
        }

        // Validar entrada específica para clasificación de tickets
        const { value: validatedInput, error: validationError } = validateTicketClassificationInput(body);
        if (validationError) {
          const details = validationError.details?.map(d => d.message).join('; ') || 'Validation error';
          return badRequest(`Input validation failed: ${details}`);
        }

        const { summary } = validatedInput;

        context.log(`🎫 Classifying ticket - Summary length: ${summary.length}`);

        // Realizar clasificación
        const classification = await classifyTicket(summary);

        // Validar salida
        const { error: outputValidationError } = validateTicketClassificationOutput(classification);
        if (outputValidationError) {
          context.log(`⚠️ Classification output validation failed: ${outputValidationError.message}`);
          // Usar clasificación por defecto si la validación falla
          const defaultClassification = {
            priority: 'normal',
            risk: 'none',
            category: 'General'
          };
          
          return success('Ticket classified (with defaults due to validation issues)', {
            classification: defaultClassification,
            metadata: {
              userEmail: email,
              userLocation: location,
              userRole: role,
              validationWarning: 'Used default values due to output validation failure'
            }
          });
        }

        context.log(`✅ Ticket classified successfully - Priority: ${classification.priority}, Risk: ${classification.risk}, Category: ${classification.category}`);

        return success('Ticket classified successfully', {
          classification,
          metadata: {
            userEmail: email,
            userLocation: location,
            userRole: role
          }
        });

      } catch (err) {
        context.log('❌ Error in ticket classification endpoint:', err);
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