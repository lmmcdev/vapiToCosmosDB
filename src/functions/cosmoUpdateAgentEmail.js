const { app } = require('@azure/functions');
const { getContainer } = require('../shared/cosmoAgentClient');
const { success, badRequest, notFound, error } = require('../shared/responseUtils');

app.http('cosmoUpdateAgentEmail', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  handler: async (req, context) => {
    const { agentId, new_email } = await req.json();

    if (!agentId || !new_email) {
      return badRequest('Faltan parámetros: agentId o new_email.');
    }

    try {
      const container = getContainer();
      const item = container.item(agentId, agentId);
      const { resource } = await item.read();

      if (!resource) return notFound('Agente no encontrado.');

      await item.patch([
        { op: 'replace', path: '/agent_email', value: new_email },
        {
          op: 'add',
          path: '/notes/-',
          value: {
            datetime: new Date().toISOString(),
            event_type: 'system_log',
            event: `Actualizado email del agente a "${new_email}"`
          }
        }
      ]);

      return success('Email actualizado correctamente.');
    } catch (err) {
      context.log('❌ Error actualizando email:', err);
      return error('Error al actualizar email.', 500, err.message);
    }
  }
});
