const { app } = require('@azure/functions');
const crypto = require('crypto');
const { getAgentContainer } = require('../shared/cosmoAgentClient');
const { success, error, badRequest, unauthorized } = require('../shared/responseUtils');

app.http('cosmoInsertAgent', {
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    let body;

    // 1. Parsear JSON
    try {
      body = await request.json();
    } catch (err) {
      context.log('Error parsing JSON:', err);
      return badRequest('Invalid JSON');
    }

    const form = body.form;

    // 2. Validar campos obligatorios
    const requiredFields = ['agent_name', 'department', 'rol', 'agent_email', 'editor_email'];
    const missingFields = requiredFields.filter(field => !form?.[field]);

    if (missingFields.length > 0) {
      return badRequest(`Missing required fields: ${missingFields.join(', ')}`);
    }

    const agent_email = form.agent_email.toLowerCase();
    const editor_email = form.editor_email.toLowerCase();

    try {
      const container = getAgentContainer();

      // 3. Verificar si el editor es Supervisor
      const supervisorQuery = {
        query: 'SELECT * FROM c WHERE c.agent_email = @editor_email',
        parameters: [{ name: '@editor_email', value: editor_email }]
      };

      const { resources: supervisors } = await container.items.query(supervisorQuery).fetchAll();
      const supervisor = supervisors[0];

      if (!supervisor) return unauthorized('Supervisor not found.');
      if (supervisor.agent_rol !== 'Supervisor') {
        return unauthorized('Only Supervisors can create agents.');
      }

      // 4. Verificar que el agente pertenezca al mismo departamento
      if (supervisor.agent_department !== form.department) {
        return unauthorized('The agent must belong to your department.');
      }

      // 5. Verificar si ya existe el agente por email
      const existingQuery = {
        query: 'SELECT * FROM c WHERE LOWER(c.agent_email) = @agent_email',
        parameters: [{ name: '@agent_email', value: agent_email }]
      };

      const { resources: existingAgents } = await container.items
        .query(existingQuery, { enableCrossPartitionQuery: true })
        .fetchAll();

      if (existingAgents.length > 0) {
        return badRequest(`There is an agent with this email already: "${agent_email}".`);
      }

      // 6. Crear nuevo documento
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
            event: `Created agent ${agent_email} by ${editor_email}`
          }
        ]
      };

      // 7. Insertar en Cosmos DB
      const { resource } = await container.items.create(newAgent, {
        partitionKey: agentId
      });

      return success('Agent created successfully.', { agent_id: agentId }, 201);

    } catch (err) {
      context.log('Error inserting in CosmosDB:', err);
      return error('Error inserting in CosmosDB.', 500, err.message);
    }
  }
});
