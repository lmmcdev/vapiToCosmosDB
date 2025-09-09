// functions/helpers/teamsNotificationHelper.js
const fetch = require('node-fetch');

// 🔗 Azure Logic App endpoint configuration
const LOGIC_APP_CONFIG = {
  baseUrl: 'https://notificationticket.azurewebsites.net:443',
  endpoint: '/api/teamsnotification/triggers/Notification_JSON_Received/invoke',
  queryParams: {
    'api-version': '2022-05-01',
    'sp': '/triggers/Notification_JSON_Received/run',
    'sv': '1.0',
    'sig': '-TREj7MxDiCI4zdbB9CGBJ07OabBrjYZyiXEaSj_PiI'
  },
  timeout: 30000, // 30 seconds timeout
  retries: 2
};

/**
 * Constructs the full Logic App URL with query parameters
 * @returns {string} The complete Logic App URL
 */
function buildLogicAppUrl() {
  const url = new URL(LOGIC_APP_CONFIG.endpoint, LOGIC_APP_CONFIG.baseUrl);
  
  // Add query parameters
  Object.entries(LOGIC_APP_CONFIG.queryParams).forEach(([key, value]) => {
    url.searchParams.append(key, value);
  });
  
  return url.toString();
}

/**
 * Validates if the user email is in a valid format and domain
 * @param {string} email - User email to validate
 * @returns {boolean} True if email is valid
 */
function isValidNotificationUser(email) {
  if (!email || typeof email !== 'string') return false;
  
  // Basic email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) return false;
  
  // Optional: Add domain whitelist if needed
  const allowedDomains = process.env.TEAMS_NOTIFICATION_ALLOWED_DOMAINS;
  if (allowedDomains) {
    const domains = allowedDomains.split(',').map(d => d.trim().toLowerCase());
    const emailDomain = email.split('@')[1]?.toLowerCase();
    return domains.includes(emailDomain);
  }
  
  return true;
}

/**
 * Sanitizes notification content to prevent potential issues
 * @param {string} notification - Notification message
 * @returns {string} Sanitized notification content
 */
function sanitizeNotificationContent(notification) {
  if (!notification || typeof notification !== 'string') return '';
  
  return notification
    .trim()
    .replace(/[<>'";&\x00-\x1F\x7F]/g, '') // Remove potential dangerous chars
    .substring(0, 2000); // Limit length
}

/**
 * Prepares the payload for the Logic App
 * @param {Object} validatedData - Validated notification data
 * @param {Object} context - Azure Functions context
 * @returns {Object} Logic App payload
 */
function prepareLogicAppPayload(validatedData, context) {
  const payload = {
    user: validatedData.user,
    notification: sanitizeNotificationContent(validatedData.notification)
  };

  // Add optional ticketId if provided
  if (validatedData.ticketId) {
    payload.ticketId = validatedData.ticketId;
  }

  // Add optional fields if provided
  if (validatedData.title) {
    payload.title = sanitizeNotificationContent(validatedData.title);
  }

  if (validatedData.priority && validatedData.priority !== 'normal') {
    payload.priority = validatedData.priority;
  }

  // Add metadata if provided
  if (validatedData.metadata) {
    payload.metadata = {
      ...validatedData.metadata,
      timestamp: new Date().toISOString(),
      source: 'vapi-api',
      functionName: context?.functionName || 'unknown'
    };
  }

  // Always add ticketId to metadata if provided for tracking
  if (validatedData.ticketId) {
    if (!payload.metadata) {
      payload.metadata = {};
    }
    payload.metadata.ticketId = validatedData.ticketId;
  }

  return payload;
}

/**
 * Sends notification to Teams via Azure Logic App
 * @param {Object} validatedData - Validated notification data
 * @param {Object} context - Azure Functions context for logging
 * @returns {Promise<Object>} Logic App response
 */
async function sendTeamsNotification(validatedData, context) {
  const startTime = Date.now();
  const logicAppUrl = buildLogicAppUrl();
  
  // Validate user email
  if (!isValidNotificationUser(validatedData.user)) {
    throw new Error(`Invalid or not allowed user email: ${validatedData.user}`);
  }

  // Prepare payload
  const payload = prepareLogicAppPayload(validatedData, context);
  
  const ticketInfo = validatedData.ticketId ? ` (ticketId: ${validatedData.ticketId})` : '';
  context.log(`📤 Sending Teams notification to ${validatedData.user}${ticketInfo}`);
  context.log(`📋 Payload:`, JSON.stringify(payload, null, 2));

  let lastError;
  
  // Retry logic
  for (let attempt = 1; attempt <= LOGIC_APP_CONFIG.retries + 1; attempt++) {
    try {
      context.log(`🔄 Attempt ${attempt}/${LOGIC_APP_CONFIG.retries + 1} - Calling Logic App`);
      
      const response = await fetch(logicAppUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'VAPI-Teams-Notification/1.0',
          'X-Request-Id': `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
        },
        body: JSON.stringify(payload),
        timeout: LOGIC_APP_CONFIG.timeout
      });

      const responseText = await response.text();
      let responseData;

      try {
        responseData = responseText ? JSON.parse(responseText) : {};
      } catch (parseError) {
        context.log('⚠️ Logic App response is not valid JSON:', responseText);
        responseData = { rawResponse: responseText };
      }

      const executionTime = Date.now() - startTime;
      
      if (!response.ok) {
        const error = new Error(`Logic App returned ${response.status}: ${response.statusText}`);
        error.code = 'LOGIC_APP_ERROR';
        error.status = response.status;
        error.statusText = response.statusText;
        error.responseData = responseData;
        error.executionTime = executionTime;
        
        context.log(`❌ Logic App error (attempt ${attempt}):`, error.message);
        
        // Don't retry on client errors (4xx)
        if (response.status >= 400 && response.status < 500) {
          throw error;
        }
        
        lastError = error;
        
        // Wait before retry (exponential backoff)
        if (attempt <= LOGIC_APP_CONFIG.retries) {
          const waitTime = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
          context.log(`⏳ Waiting ${waitTime}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
          continue;
        }
        
        throw error;
      }

      context.log(`✅ Teams notification sent successfully (attempt ${attempt})`);
      context.log(`⏱️ Execution time: ${executionTime}ms`);
      
      return {
        success: true,
        status: response.status,
        statusText: response.statusText,
        data: responseData,
        executionTime,
        attempt
      };

    } catch (error) {
      lastError = error;
      context.log(`❌ Error on attempt ${attempt}:`, error.message);
      
      // Don't retry on validation or client errors
      if (error.code === 'LOGIC_APP_ERROR' && error.status >= 400 && error.status < 500) {
        throw error;
      }
      
      if (attempt <= LOGIC_APP_CONFIG.retries) {
        const waitTime = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
        context.log(`⏳ Waiting ${waitTime}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }
    }
  }
  
  // All retries exhausted
  const executionTime = Date.now() - startTime;
  lastError.executionTime = executionTime;
  context.log(`💥 All retry attempts exhausted. Final error:`, lastError.message);
  throw lastError;
}

/**
 * Validates Logic App configuration
 * @returns {Object} Configuration validation result
 */
function validateLogicAppConfiguration() {
  const issues = [];
  
  if (!LOGIC_APP_CONFIG.baseUrl) {
    issues.push('Missing Logic App base URL');
  }
  
  if (!LOGIC_APP_CONFIG.queryParams.sig) {
    issues.push('Missing Logic App signature');
  }
  
  if (!LOGIC_APP_CONFIG.endpoint) {
    issues.push('Missing Logic App endpoint');
  }
  
  return {
    isValid: issues.length === 0,
    issues,
    config: {
      baseUrl: LOGIC_APP_CONFIG.baseUrl,
      endpoint: LOGIC_APP_CONFIG.endpoint,
      timeout: LOGIC_APP_CONFIG.timeout,
      retries: LOGIC_APP_CONFIG.retries
    }
  };
}

module.exports = {
  sendTeamsNotification,
  buildLogicAppUrl,
  isValidNotificationUser,
  sanitizeNotificationContent,
  prepareLogicAppPayload,
  validateLogicAppConfiguration,
  LOGIC_APP_CONFIG
};