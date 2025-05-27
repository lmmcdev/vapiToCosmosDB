const { app } = require('@azure/functions');
const { getContainer } = require('../shared/cosmoAgentClient');
const { success, badRequest, notFound, error } = require('../shared/responseUtils');

app.http('cosmoUpdateAgentDepartment', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  handler: async (req, context) => {
    const { agentId, new_department } = await req.json();

    if (!agentId || !new_department) {
      return badRequest('Faltan parámetros: agentId o new_department.');
    }

    try {
      const container = getContainer();
      const item = container.item(agentId, agentId);
      const { resource } = await item.read();

      if (!resource) return notFound('Agente no encontrado.');

      await item.patch([
        { op: 'replace', path: '/agent_department', value: new_department },
        {
          op: 'add',
          path: '/notes/-',
          value: {
            datetime: new Date().toISOString(),
            event_type: 'system_log',
            event: `Actualizado departamento a "${new_department}"`
          }
        }
      ]);

      return success('Departamento actualizado correctamente.');
    } catch (err) {
      context.log('❌ Error actualizando departamento:', err);
      return error('Error al actualizar departamento.', 500, err.message);
    }
  }
});
