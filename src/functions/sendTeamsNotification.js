// src/functions/sendTeamsNotification/index.js (CommonJS)
const { app } = require('@azure/functions');

// Response utilities
const { success, badRequest, error } = require('../shared/responseUtils');

// Auth utilities
const { withAuth } = require('./auth/withAuth');
const { GROUPS } = require('./auth/groups.config');
const { getEmailFromClaims } = require('./auth/auth.helper');
const { resolveUserDepartment } = require('./helpers/resolveDepartment');

// Teams notification utilities
const {
  validateNotificationRequest,
  formatNotificationResponse,
  formatNotificationErrorResponse
} = require('./dtos/teamsNotification.dto');

const {
  sendTeamsNotification,
  validateLogicAppConfiguration
} = require('./helpers/teamsNotificationHelper');

// Helper para timestamp
const { getMiamiNow } = require('./helpers/timeHelper');

// 🔹 Extraer todos los ACCESS_GROUPs (acceso a todos los grupos)
const ALL_ACCESS_GROUPS = Object.values(GROUPS)
  .map((dept) => dept.ACCESS_GROUP)
  .filter(Boolean);

app.http('sendTeamsNotification', {
  route: 'teams/notification',
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: withAuth(
    async (request, context) => {
      const executionStartTime = Date.now();
      const { dateISO: timestamp } = getMiamiNow();
      
      try {
        // 1) Validar configuración de Logic App al inicio
        const configValidation = validateLogicAppConfiguration();
        if (!configValidation.isValid) {
          context.log('❌ Logic App configuration invalid:', configValidation.issues);
          return error(
            'Teams notification service is not properly configured',
            500,
            configValidation.issues.join('; ')
          );
        }

        // 2) Obtener usuario autenticado
        const claims = context.user;
        const userEmail = getEmailFromClaims(claims);
        
        if (!userEmail) {
          return { 
            status: 401, 
            jsonBody: { error: 'Email not found in token' } 
          };
        }

        // 3) Resolver departamento del usuario
        const { location, role } = resolveUserDepartment(claims);
        if (!location || !role) {
          return { 
            status: 403, 
            jsonBody: { error: 'User has no valid location/role for Teams notifications' } 
          };
        }

        context.log(`📱 Teams notification request from user: ${userEmail}, location: ${location}, role: ${role}`);

        // 4) Parsear y validar body de la request
        let body;
        try {
          body = await request.json();
        } catch (parseError) {
          context.log('❌ JSON parse error:', parseError.message);
          return badRequest('Invalid JSON format in request body');
        }

        // 5) Validar entrada con DTO
        let validatedData;
        try {
          validatedData = validateNotificationRequest(body);
          context.log(`📝 Validated notification request:`, {
            user: validatedData.user,
            notificationLength: validatedData.notification?.length || 0,
            ticketId: validatedData.ticketId || null,
            priority: validatedData.priority,
            hasTitle: !!validatedData.title,
            hasMetadata: !!validatedData.metadata
          });
        } catch (validationError) {
          context.log('❌ Validation error:', validationError.message);
          return badRequest(`Input validation failed: ${validationError.message}`);
        }

        // 6) Agregar metadata de contexto
        if (!validatedData.metadata) {
          validatedData.metadata = {};
        }
        
        validatedData.metadata = {
          ...validatedData.metadata,
          requestedBy: userEmail,
          requestedByLocation: location,
          requestedByRole: role,
          timestamp: timestamp,
          source: 'vapi-teams-notification-api'
        };

        // 7) Enviar notificación via Logic App
        context.log(`🚀 Sending Teams notification to ${validatedData.user}`);
        
        const logicAppResponse = await sendTeamsNotification(validatedData, context);
        
        context.log(`✅ Teams notification sent successfully:`, {
          user: validatedData.user,
          ticketId: validatedData.ticketId || null,
          status: logicAppResponse.status,
          executionTime: logicAppResponse.executionTime,
          attempt: logicAppResponse.attempt
        });

        // 8) Formatear respuesta exitosa
        const responseData = formatNotificationResponse(
          validatedData,
          logicAppResponse,
          executionStartTime
        );

        return success('Teams notification sent successfully', responseData.data);

      } catch (err) {
        context.log('❌ Error in Teams notification endpoint:', err);
        
        // Determinar el tipo de error
        let statusCode = 500;
        let errorMessage = 'Internal server error';
        
        if (err.code === 'LOGIC_APP_ERROR') {
          statusCode = err.status >= 400 && err.status < 500 ? 400 : 500;
          errorMessage = `Logic App error: ${err.message}`;
        } else if (err.message?.includes('Invalid or not allowed user email')) {
          statusCode = 400;
          errorMessage = 'Invalid recipient email address';
        } else if (err.message?.includes('timeout')) {
          statusCode = 504;
          errorMessage = 'Teams notification service timeout';
        } else if (err.message?.includes('fetch')) {
          statusCode = 503;
          errorMessage = 'Teams notification service unavailable';
        }

        // Formatear respuesta de error
        const errorResponse = formatNotificationErrorResponse(
          request.body || {},
          err,
          executionStartTime
        );

        context.log('📤 Sending error response:', {
          statusCode,
          errorMessage,
          executionTime: errorResponse.error.executionTime
        });

        return error(errorMessage, statusCode, errorResponse.error);
      }
    },
    {
      // 🔐 Seguridad: Acceso para todos los grupos autorizados
      scopesAny: ['access_as_user'],
      groupsAny: ALL_ACCESS_GROUPS,
    }
  ),
});

// 🔍 Endpoint adicional para validar la configuración de Teams (solo supervisores)
const SUPERVISOR_GROUPS = Object.values(GROUPS)
  .map(dept => dept.SUPERVISORS_GROUP)
  .filter(Boolean);

app.http('teamsNotificationConfig', {
  route: 'teams/notification/config',
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: withAuth(
    async (request, context) => {
      try {
        const claims = context.user;
        const userEmail = getEmailFromClaims(claims);
        
        context.log(`🔍 Teams notification config check by: ${userEmail}`);

        // Validar configuración
        const configValidation = validateLogicAppConfiguration();
        
        const responseData = {
          isConfigured: configValidation.isValid,
          timestamp: new Date().toISOString(),
          checkedBy: userEmail,
          configuration: {
            ...configValidation.config,
            // Ocultar información sensible
            signature: configValidation.config.baseUrl ? '***CONFIGURED***' : 'NOT_SET'
          }
        };

        if (!configValidation.isValid) {
          responseData.issues = configValidation.issues;
          context.log('⚠️ Configuration issues found:', configValidation.issues);
        }

        return success('Teams notification configuration status', responseData);

      } catch (err) {
        context.log('❌ Error checking Teams notification config:', err);
        return error('Error checking configuration', 500, err.message);
      }
    },
    {
      // 🔐 Solo supervisores pueden ver la configuración
      scopesAny: ['access_as_user'],
      groupsAny: SUPERVISOR_GROUPS,
    }
  ),
});