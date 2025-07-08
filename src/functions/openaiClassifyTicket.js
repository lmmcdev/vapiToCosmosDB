const { app } = require('@azure/functions');
const fetch = require('node-fetch');
const { success, error, badRequest, unauthorized } = require('../shared/responseUtils');


const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
const apiKey = process.env.AZURE_OPENAI_KEY;
const deployment = "gpt-4.1"; 

app.http('openAiClassifyTicket', {
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    try {
      const { text } = await request.json();
      if (!text) {
        return { status: 400, body: "Falta 'text'" };
      }

      const prompt = [
        {
          role: "system",
          content: `Eres un clasificador de tickets clientes pacientes mayores de edad de una clinica de salud, 
            analiza el resumen de la llamada y devuelve un JSON con los siguientes campos: priority (high, normal, low), risk (none, legal, desenrollment posibble), category (Move appointment, Transport needed, Appointment confirmation, Services request, New patient, Desenrollment requested, Recipes needed, Need personal attention, New patient direction, General)`
        },
        {
          role: "user",
          content: `Resumen: "${text}"`
        }
      ];

      const res = await fetch(
        `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=2025-01-01-preview`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "api-key": apiKey
          },
          body: JSON.stringify({ messages: prompt, temperature: 0 })
        }
      );

      if (!res.ok) {
        const errorText = await res.text();
        context.log(`OpenAI error: ${errorText}`);
        return badRequest(`Error consulting OpenAI ${error.message}`)
      }

      const json = await res.json();
      const raw = json.choices[0].message.content.trim();
      const result = JSON.parse(raw);

      return success('OpenAI correct', { result });
    } catch (err) {
      context.log(`Error OpenAI classify: ${err.message}`);
      return badRequest(`Error: ${err.message}`)
    }
  }
});
