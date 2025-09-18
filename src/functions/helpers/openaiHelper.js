const fetch = require('node-fetch');

const openaiEndpoint = process.env.AZURE_OPENAI_ENDPOINT;
const openaiApiKey = process.env.AZURE_OPENAI_KEY;
const deployment = 'gpt-35-turbo';

/**
 * Envía una consulta a OpenAI Azure y devuelve la respuesta JSON parseada
 * @param {string} systemPrompt - El prompt del sistema que define el comportamiento
 * @param {string} userContent - El contenido a analizar por el usuario
 * @param {object} options - Opciones adicionales para la consulta
 * @param {number} options.temperature - Temperatura para la respuesta (default: 0)
 * @param {number} options.maxTokens - Máximo número de tokens (default: undefined)
 * @param {string} options.deploymentName - Nombre del deployment a usar (default: 'gpt-35-turbo')
 * @returns {Promise<{success: boolean, data?: any, error?: string}>}
 */
async function queryOpenAI(systemPrompt, userContent, options = {}) {
  const {
    temperature = 0,
    maxTokens,
    deploymentName = deployment
  } = options;

  // Validación de parámetros
  if (!systemPrompt || typeof systemPrompt !== 'string') {
    return {
      success: false,
      error: 'System prompt is required and must be a string'
    };
  }

  if (!userContent || typeof userContent !== 'string') {
    return {
      success: false,
      error: 'User content is required and must be a string'
    };
  }

  // Validación de configuración
  if (!openaiEndpoint || !openaiApiKey) {
    return {
      success: false,
      error: 'OpenAI configuration is missing (endpoint or API key)'
    };
  }

  try {
    const requestBody = {
      messages: [
        {
          role: 'system',
          content: systemPrompt
        },
        {
          role: 'user',
          content: userContent
        }
      ],
      temperature
    };

    // Agregar max_tokens solo si se especifica
    if (maxTokens && typeof maxTokens === 'number' && maxTokens > 0) {
      requestBody.max_tokens = maxTokens;
    }

    const response = await fetch(
      `${openaiEndpoint}/openai/deployments/${deploymentName}/chat/completions?api-version=2025-01-01-preview`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': openaiApiKey
        },
        body: JSON.stringify(requestBody)
      }
    );

    if (!response.ok) {
      return {
        success: false,
        error: `OpenAI API error: ${response.status} ${response.statusText}`
      };
    }

    const result = await response.json();
    
    // Validar estructura de respuesta
    if (!result.choices || !Array.isArray(result.choices) || result.choices.length === 0) {
      return {
        success: false,
        error: 'Invalid response structure from OpenAI API'
      };
    }

    const content = result.choices[0]?.message?.content;
    
    if (!content) {
      return {
        success: false,
        error: 'No content received from OpenAI API'
      };
    }

    // Intentar parsear como JSON si el contenido parece ser JSON
    let parsedContent = content.trim();
    if (parsedContent.startsWith('{') || parsedContent.startsWith('[')) {
      try {
        parsedContent = JSON.parse(parsedContent);
      } catch (parseError) {
        // Si no se puede parsear como JSON, devolver como string
        // No es necesariamente un error
      }
    }

    return {
      success: true,
      data: parsedContent,
      rawResponse: {
        usage: result.usage,
        model: result.model,
        created: result.created
      }
    };

  } catch (error) {
    return {
      success: false,
      error: `OpenAI query failed: ${error.message}`
    };
  }
}

/**
 * Realiza una consulta unificada combinando múltiples contenidos de usuario en una sola evaluación
 * @param {string} systemPrompt - El prompt del sistema que define el comportamiento
 * @param {Array<{content: string, id?: string}>} userContents - Array de contenidos a combinar
 * @param {object} options - Opciones adicionales para la consulta
 * @returns {Promise<{success: boolean, data?: any, error?: string, combinedContent?: string}>}
 */
async function queryOpenAIUnified(systemPrompt, userContents, options = {}) {
  // Validación de parámetros
  if (!Array.isArray(userContents) || userContents.length === 0) {
    return {
      success: false,
      error: 'userContents must be a non-empty array'
    };
  }

  // Combinar todos los contenidos en un solo texto
  const combinedContent = userContents
    .map((item, index) => {
      const id = item.id || `evaluation_${index + 1}`;
      return `**Evaluación ${id}:**\n${item.content}`;
    })
    .join('\n\n');

  // Usar la función queryOpenAI existente con el contenido combinado
  const result = await queryOpenAI(systemPrompt, combinedContent, options);

  // Agregar el contenido combinado al resultado para referencia
  if (result.success) {
    return {
      ...result,
      combinedContent
    };
  }

  return result;
}

/**
 * Función específica para clasificación de tickets (mantiene compatibilidad con código existente)
 * @param {string} summary - Resumen del ticket a clasificar
 * @returns {Promise<{priority: string, risk: string, category: string}>}
 */
async function classifyTicket(summary) {
  const systemPrompt = 'Responde SOLO en JSON con priority (low, medium, high), risk (none, legal, disenrollment), y category (transport, appointment, new patient, disenrollment, customer service, new address, hospitalization, others).';

  const result = await queryOpenAI(systemPrompt, `Resumen: "${summary}"`);

  // Valores por defecto en caso de error
  const defaultClassification = {
    priority: 'normal',
    risk: 'none',
    category: 'General'
  };

  if (!result.success) {
    return defaultClassification;
  }

  // Si la respuesta es un objeto, usarlo directamente
  if (typeof result.data === 'object' && result.data !== null) {
    return {
      priority: result.data.priority || defaultClassification.priority,
      risk: result.data.risk || defaultClassification.risk,
      category: result.data.category || defaultClassification.category
    };
  }

  return defaultClassification;
}

module.exports = {
  queryOpenAI,
  queryOpenAIUnified,
  classifyTicket
};