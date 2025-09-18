const { app } = require('@azure/functions');
const { success, error, badRequest } = require('../shared/responseUtils');
const { withAuth } = require('./auth/withAuth');
const { getEmailFromClaims } = require('./auth/auth.helper');
const { resolveUserDepartment } = require('./helpers/resolveDepartment');
const { GROUPS } = require('./auth/groups.config');
const { queryOpenAI, queryOpenAIUnified, classifyTicket } = require('./helpers/openaiHelper');
const {
  validateOpenAIInput,
  validateOpenAIBulkInput,
  validateOpenAIUnifiedInput,
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

// Endpoint para consultas bulk de OpenAI
app.http('openaiQueryBulk', {
  route: 'openai/query-bulk',
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

        context.log(`✅ Bulk OpenAI query from user: ${email}, location: ${location}, role: ${role}`);

        // Obtener y validar el body de la request
        let body;
        try {
          body = await req.json();
        } catch (parseError) {
          return badRequest('Invalid JSON in request body');
        }

        // Validar entrada con DTO
        const { value: validatedInput, error: validationError } = validateOpenAIBulkInput(body);
        if (validationError) {
          const details = validationError.details?.map(d => d.message).join('; ') || 'Validation error';
          return badRequest(`Input validation failed: ${details}`);
        }

        const { systemPrompt, userContents, options = {} } = validatedInput;

        context.log(`🤖 Bulk OpenAI query - System prompt length: ${systemPrompt.length}, Contents count: ${userContents.length}`);

        // Procesar múltiples contenidos con el mismo systemPrompt
        const results = [];
        const errors = [];
        let totalUsage = {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0
        };

        // Procesar contenidos de manera eficiente
        const processContent = async (userContentItem, index) => {
          // Extraer contenido dependiendo si es string u objeto
          let content, itemId, metadata;
          if (typeof userContentItem === 'string') {
            content = userContentItem;
            itemId = `item_${index}`;
            metadata = {};
          } else {
            content = userContentItem.content;
            itemId = userContentItem.id || `item_${index}`;
            metadata = userContentItem.metadata || {};
          }

          try {
            context.log(`🔄 Processing content ${index + 1}/${userContents.length} - ID: ${itemId}`);

            // Realizar consulta a OpenAI con el mismo systemPrompt
            const result = await queryOpenAI(systemPrompt, content, options);

            if (result.success) {
              // Acumular estadísticas de uso
              if (result.rawResponse?.usage) {
                totalUsage.prompt_tokens += result.rawResponse.usage.prompt_tokens || 0;
                totalUsage.completion_tokens += result.rawResponse.usage.completion_tokens || 0;
                totalUsage.total_tokens += result.rawResponse.usage.total_tokens || 0;
              }

              return {
                type: 'success',
                data: {
                  id: itemId,
                  result: result.data,
                  metadata: {
                    ...metadata,
                    responseType: typeof result.data,
                    usage: result.rawResponse?.usage,
                    processedAt: new Date().toISOString(),
                    contentLength: content.length
                  }
                }
              };
            } else {
              return {
                type: 'error',
                data: {
                  id: itemId,
                  error: result.error,
                  metadata: {
                    ...metadata,
                    contentLength: content.length,
                    failedAt: new Date().toISOString()
                  }
                }
              };
            }
          } catch (err) {
            context.log(`❌ Error processing content ${itemId}:`, err.message);
            return {
              type: 'error',
              data: {
                id: itemId,
                error: `Processing error: ${err.message}`,
                metadata: {
                  ...metadata,
                  contentLength: content.length,
                  failedAt: new Date().toISOString()
                }
              }
            };
          }
        };

        // Procesar todos los contenidos secuencialmente para evitar rate limits
        for (let i = 0; i < userContents.length; i++) {
          const processResult = await processContent(userContents[i], i);

          if (processResult.type === 'success') {
            results.push(processResult.data);
          } else {
            errors.push(processResult.data);
          }
        }

        // Log de resultados
        context.log(`✅ Bulk OpenAI query completed - Successful: ${results.length}, Failed: ${errors.length}`);
        context.log(`📊 Total usage - Tokens: ${totalUsage.total_tokens}, Prompt: ${totalUsage.prompt_tokens}, Completion: ${totalUsage.completion_tokens}`);

        // Respuesta exitosa con resultados y errores
        return success('Bulk OpenAI query completed successfully', {
          results,
          errors,
          summary: {
            total: userContents.length,
            successful: results.length,
            failed: errors.length,
            totalUsage,
            averageContentLength: userContents.reduce((acc, item) => {
              const content = typeof item === 'string' ? item : item.content;
              return acc + content.length;
            }, 0) / userContents.length
          },
          metadata: {
            userEmail: email,
            userLocation: location,
            userRole: role,
            systemPrompt: {
              length: systemPrompt.length,
              preview: systemPrompt.substring(0, 100) + (systemPrompt.length > 100 ? '...' : '')
            },
            options: {
              temperature: options.temperature || 0,
              maxTokens: options.maxTokens || 'default',
              deploymentName: options.deploymentName || 'gpt-35-turbo'
            },
            processedAt: new Date().toISOString()
          }
        });

      } catch (err) {
        context.log('❌ Error in bulk OpenAI query endpoint:', err);
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