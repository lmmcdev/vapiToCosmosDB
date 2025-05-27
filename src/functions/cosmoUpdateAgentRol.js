const { app } = require('@azure/functions');
const { getContainer } = require('../shared/cosmoAgentClient');
const { success, badRequest, notFound, error } = require('../shared/responseUtils');

app.http('cosmoUpdateAgentRol', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  handler: async (req, context) => {
    const { agentId, new_rol } = await req.json();

    if (!agentId || !new_rol) {
      return badRequest('Faltan parámetros: agentId o new_rol.');
    }

    try {
      const container = getContainer();
      const item = container.item(agentId, agentId);
      const { resource } = await item.read();

      if (!resource) return notFound('Agente no encontrado.');

      await item.patch([
        { op: 'replace', path: '/agent_rol', value: new_rol },
        {
          op: 'add',
          path: '/notes/-',
          value: {
            datetime: new Date().toISOString(),
            event_type: 'system_log',
            event: `Actualizado rol del agente a "${new_rol}"`
          }
        }
      ]);

      return success('Rol actualizado correctamente.');
    } catch (err) {
      context.log('❌ Error actualizando rol:', err);
      return error('Error al actualizar rol.', 500, err.message);
    }
  }
});
