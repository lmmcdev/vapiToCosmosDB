// functions/dtos/teamsNotification.dto.js
const Joi = require('joi');

// 🔔 Schema: Teams notification input validation
const teamsNotificationInput = Joi.object({
  user: Joi.string()
    .email()
    .required()
    .label('user')
    .description('Email address of the user to notify'),
  
  notification: Joi.string()
    .trim()
    .min(1)
    .max(2000)
    .required()
    .label('notification')
    .description('Notification message content'),
  
  // Optional ticket ID parameter
  ticketId: Joi.string()
    .uuid()
    .optional()
    .label('ticketId')
    .description('Optional ticket ID associated with this notification'),
  
  // Optional additional fields
  priority: Joi.string()
    .valid('low', 'normal', 'high', 'urgent')
    .optional()
    .default('normal')
    .label('priority')
    .description('Notification priority level'),
  
  title: Joi.string()
    .trim()
    .max(200)
    .optional()
    .label('title')
    .description('Optional notification title'),
  
  metadata: Joi.object({
    source: Joi.string().max(50).optional(),
    timestamp: Joi.string().isoDate().optional(),
    additionalInfo: Joi.string().max(500).optional()
  })
    .optional()
    .label('metadata')
    .description('Optional metadata for notification context')
}).options({
  abortEarly: false,
  stripUnknown: true,
  allowUnknown: false
});

// 📤 Schema: Teams notification response validation  
const teamsNotificationOutput = Joi.object({
  success: Joi.boolean().required(),
  message: Joi.string().required(),
  data: Joi.object({
    notificationId: Joi.string().optional(),
    user: Joi.string().email().required(),
    notification: Joi.string().required(),
    ticketId: Joi.string().uuid().optional(),
    priority: Joi.string().valid('low', 'normal', 'high', 'urgent').optional(),
    title: Joi.string().optional(),
    timestamp: Joi.string().isoDate().required(),
    logicAppResponse: Joi.object({
      status: Joi.number().required(),
      statusText: Joi.string().optional(),
      executionTime: Joi.number().optional()
    }).optional()
  }).required()
}).options({
  abortEarly: false,
  allowUnknown: true
});

// 🔍 Helper function to validate and format notification request
function validateNotificationRequest(rawInput) {
  const { error, value } = teamsNotificationInput.validate(rawInput, {
    abortEarly: false,
    stripUnknown: true
  });

  if (error) {
    const details = error.details.map(d => d.message).join('; ');
    throw new Error(`Validation error: ${details}`);
  }

  return value;
}

// 🔧 Helper function to format notification response
function formatNotificationResponse(requestData, logicAppResponse, executionStartTime) {
  const executionTime = executionStartTime ? Date.now() - executionStartTime : undefined;
  
  const responseData = {
    success: true,
    message: 'Teams notification sent successfully',
    data: {
      user: requestData.user,
      notification: requestData.notification,
      ticketId: requestData.ticketId || undefined,
      priority: requestData.priority || 'normal',
      title: requestData.title || undefined,
      timestamp: new Date().toISOString(),
      logicAppResponse: {
        status: logicAppResponse?.status || 200,
        statusText: logicAppResponse?.statusText || 'OK',
        executionTime
      }
    }
  };

  // Add notification ID if provided by Logic App
  if (logicAppResponse?.data?.notificationId) {
    responseData.data.notificationId = logicAppResponse.data.notificationId;
  }

  // Validate output format
  const { error } = teamsNotificationOutput.validate(responseData);
  if (error) {
    console.warn('Response validation warning:', error.details);
  }

  return responseData;
}

// 🚨 Helper function to format error response
function formatNotificationErrorResponse(requestData, error, executionStartTime) {
  const executionTime = executionStartTime ? Date.now() - executionStartTime : undefined;
  
  return {
    success: false,
    message: 'Failed to send Teams notification',
    error: {
      message: error.message || 'Unknown error',
      code: error.code || 'NOTIFICATION_ERROR',
      timestamp: new Date().toISOString(),
      executionTime
    },
    data: {
      user: requestData?.user || 'unknown',
      notification: requestData?.notification ? requestData.notification.substring(0, 100) + '...' : 'unknown',
      ticketId: requestData?.ticketId || undefined,
      priority: requestData?.priority || 'normal'
    }
  };
}

module.exports = {
  teamsNotificationInput,
  teamsNotificationOutput,
  validateNotificationRequest,
  formatNotificationResponse,
  formatNotificationErrorResponse
};