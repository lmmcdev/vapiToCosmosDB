const { queryOpenAI } = require('./openaiHelper');

/**
 * Analiza una transcripción de llamada y devuelve métricas de calidad
 * @param {string} transcription - La transcripción de la llamada a analizar
 * @param {object} options - Opciones adicionales para el análisis
 * @param {number} options.temperature - Temperatura para OpenAI (default: 0)
 * @param {number} options.maxTokens - Máximo número de tokens (default: 1500)
 * @returns {Promise<{success: boolean, data?: object, error?: string}>}
 */
async function analyzeCallTranscription(transcription, options = {}) {
  const {
    temperature = 0,
    maxTokens = 1500
  } = options;

  // Validación de entrada
  if (!transcription || typeof transcription !== 'string') {
    return {
      success: false,
      error: 'Transcription is required and must be a string'
    };
  }

  const systemPrompt = `Eres un experto en análisis de calidad de llamadas de centros de atención médica. Analiza la siguiente transcripción de llamada y devuelve un análisis detallado en formato JSON ESTRICTO.

INSTRUCCIONES DE ANÁLISIS:

1. SCORES (puntuaciones numéricas):
   - empathy_present: true/false si el agente muestra empatía
   - interruptions_agent: número de veces que el agente interrumpe al usuario
   - clarifying_q_per_min: preguntas aclaratorias por minuto (estimar duración de la llamada)
   - script_adherence: puntuación 0.0-1.0 de adherencia al protocolo médico
   - pii_detected: array de información personal detectada ["nombre", "fecha_nacimiento", "telefono", etc]

2. CHECKLIST (cumplimiento de protocolo):
   - greeting: true/false si hay saludo profesional
   - id_verification: true/false si se verifica identidad del paciente
   - problem_restatement: true/false si se reformula el problema del paciente
   - solution_or_next_step: true/false si se ofrece solución o siguiente paso
   - closing: true/false si hay cierre profesional

3. TRIAGE (evaluación de riesgo):
   - risk_level: "low", "medium", "high" basado en urgencia médica
   - escalation_needed: true/false/null si necesita escalación
   - escalation_done: true/false/null si se realizó escalación

4. IMPROVEMENT_TIPS: array de consejos específicos para mejorar

5. CITATIONS: array de objetos con {turn: número_de_turno, text: "texto_específico"} que respaldan el análisis

FORMATO DE SALIDA - SOLO JSON SIN TEXTO ADICIONAL:
{
  "scores": {
    "empathy_present": boolean,
    "interruptions_agent": number,
    "clarifying_q_per_min": number,
    "script_adherence": number,
    "pii_detected": []
  },
  "checklist": {
    "greeting": boolean,
    "id_verification": boolean,
    "problem_restatement": boolean,
    "solution_or_next_step": boolean,
    "closing": boolean
  },
  "triage": {
    "risk_level": string,
    "escalation_needed": boolean_or_null,
    "escalation_done": boolean_or_null
  },
  "improvement_tips": [],
  "citations": []
}`;

  const result = await queryOpenAI(systemPrompt, transcription, {
    temperature,
    maxTokens
  });

  if (!result.success) {
    return {
      success: false,
      error: `Call analysis failed: ${result.error}`
    };
  }

  // Validar que la respuesta tenga la estructura esperada
  if (typeof result.data !== 'object' || result.data === null) {
    return {
      success: false,
      error: 'Invalid analysis response format'
    };
  }

  const requiredKeys = ['scores', 'checklist', 'triage', 'improvement_tips', 'citations'];
  const missingKeys = requiredKeys.filter(key => !(key in result.data));
  
  if (missingKeys.length > 0) {
    return {
      success: false,
      error: `Missing required keys in analysis: ${missingKeys.join(', ')}`
    };
  }

  return {
    success: true,
    data: result.data,
    rawResponse: result.rawResponse
  };
}

/**
 * Calcula la duración estimada de una llamada basándose en turnos de conversación
 * @param {string} transcription - La transcripción de la llamada
 * @returns {number} Duración estimada en minutos
 */
function estimateCallDuration(transcription) {
  // Contar turnos de conversación (AI: y User:)
  const aiTurns = (transcription.match(/AI:/g) || []).length;
  const userTurns = (transcription.match(/User:/g) || []).length;
  const totalTurns = aiTurns + userTurns;
  
  // Estimar ~30 segundos por turno promedio
  const estimatedSeconds = totalTurns * 30;
  return Math.max(1, Math.round(estimatedSeconds / 60)); // Mínimo 1 minuto
}

/**
 * Extrae métricas básicas de la transcripción
 * @param {string} transcription - La transcripción de la llamada
 * @returns {object} Métricas básicas de la transcripción
 */
function extractBasicMetrics(transcription) {
  const aiTurns = (transcription.match(/AI:/g) || []).length;
  const userTurns = (transcription.match(/User:/g) || []).length;
  const wordCount = transcription.split(/\s+/).length;
  const estimatedDuration = estimateCallDuration(transcription);
  
  return {
    ai_turns: aiTurns,
    user_turns: userTurns,
    total_turns: aiTurns + userTurns,
    word_count: wordCount,
    estimated_duration_minutes: estimatedDuration
  };
}

module.exports = {
  analyzeCallTranscription,
  estimateCallDuration,
  extractBasicMetrics
};