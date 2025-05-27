const { app } = require('@azure/functions');
const crypto = require('crypto');
const { getContainer } = require('../shared/cosmoAgentClient');
const { success, error, badRequest } = require('../shared/responseUtils');

app.http('cosmoInsertAgent', {
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    let body;

    // 1. Parsear JSON
    try {
      body = await request.json();
    } catch (err) {
      context.log('❌ Error al parsear JSON:', err);
      return badRequest('Formato JSON inválido');
    }

    const form = body.form;

    // 2. Validar campos obligatorios
    const requiredFields = ['agent_name', 'department', 'rol', 'agent_email'];
    const missingFields = requiredFields.filter(field => !form?.[field]);

    if (missingFields.length > 0) {
      return badRequest(`Faltan campos obligatorios: ${missingFields.join(', ')}`);
    }

    const agent_email = form.agent_email.toLowerCase();

    try {
      const container = getContainer();

      // 3. Verificar si ya existe el agente por email
      const querySpec = {
        query: 'SELECT * FROM c WHERE LOWER(c.agent_email) = @agent_email',
        parameters: [{ name: '@agent_email', value: agent_email }]
      };

      const { resources: existingAgents } = await container.items
        .query(querySpec, { enableCrossPartitionQuery: true })
        .fetchAll();

      if (existingAgents.length > 0) {
        return badRequest(`Ya existe un agente con el email "${agent_email}".`);
      }

      // 4. Generar nuevo documento
      const date = new Date();
      const agentId = crypto.randomUUID();

      const newAgent = {
        id: agentId,
        agents: agentId,
        agent_name: form.agent_name,
        agent_email,
        agent_rol: form.rol,
        agent_department: form.department,
        remote_agent: form.agent_remote || false,
        timestamp: date.toISOString(),
        notes: [
          {
            datetime: date.toISOString(),
            event_type: 'system_log',
            event: `Nuevo agente creado: ${form.agent_name}`
          }
        ]
      };

      // 5. Insertar en Cosmos DB
      const { resource } = await container.items.create(newAgent, {
        partitionKey: agentId
      });

      return success('Agente insertado correctamente.', { agent_id: agentId }, 201);

    } catch (err) {
      context.log('❌ Error al insertar en Cosmos DB:', err);
      return error('Error al insertar en la base de datos.', 500, err.message);
    }
  }
});
