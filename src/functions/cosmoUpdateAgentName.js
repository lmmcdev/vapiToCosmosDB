const { app } = require('@azure/functions');
const { getContainer } = require('../shared/cosmoAgentClient');
const { success, badRequest, notFound, error } = require('../shared/responseUtils');

app.http('cosmoUpdateAgentName', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  handler: async (req, context) => {
    const { agentId, new_name } = await req.json();

    if (!agentId || !new_name) {
      return badRequest('Faltan parámetros: agentId o new_name.');
    }

    try {
      const container = getContainer();
      const item = container.item(agentId, agentId);
      const { resource } = await item.read();

      if (!resource) return notFound('Agente no encontrado.');

      await item.patch([
        { op: 'replace', path: '/agent_name', value: new_name },
        {
          op: 'add',
          path: '/notes/-',
          value: {
            datetime: new Date().toISOString(),
            event_type: 'system_log',
            event: `Actualizado nombre del agente a "${new_name}"`
          }
        }
      ]);

      return success('Nombre del agente actualizado correctamente.');
    } catch (err) {
      context.log('❌ Error actualizando nombre:', err);
      return error('Error al actualizar nombre.', 500, err.message);
    }
  }
});
