const { app } = require('@azure/functions');
const { getAgentContainer } = require('../shared/cosmoAgentClient');
const { success, badRequest, notFound, error, unauthorized } = require('../shared/responseUtils');

app.http('cosmoUpdateAgent', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  handler: async (req, context) => {
    const body = await req.json();

    const requiredFields = [
      'agentId',
      'editor_email',
      'agent_name',
      'agent_email',
      'agent_rol',
      'agent_department',
      'remote_agent',
      'disabled_agent'
    ];

    const missingFields = requiredFields.filter(field => !(field in body));

    if (missingFields.length > 0) {
      return badRequest(`Missing required parameters: ${missingFields.join(', ')}`);
    }

    const {
      agentId,
      editor_email,
      agent_name,
      agent_email,
      agent_rol,
      agent_department,
      remote_agent,
      disabled_agent
    } = body;

    try {
      const container = getAgentContainer();

      // Verificar editor
      const editorQuery = {
        query: 'SELECT * FROM c WHERE c.agent_email = @editor_email',
        parameters: [{ name: '@editor_email', value: editor_email }],
      };
      const { resources: editors } = await container.items.query(editorQuery).fetchAll();
      const editor = editors[0];

      if (!editor) return unauthorized('Supervisor not found.');
      if (editor.agent_rol !== 'Supervisor') return unauthorized('Only Supervisors can edit agents.');

      // Leer agente a editar
      const item = container.item(agentId, agentId);
      const { resource: agent } = await item.read();

      if (!agent) return notFound('Agent not found.');

      if (editor.agent_department !== agent.agent_department) {
        return unauthorized('Agent does not belong to your department.');
      }

      const patchOps = [];
      const detailedNotes = [];

      const email_managed = disabled_agent ? '' : agent_email;


      const fieldsToUpdate = {
        agent_name,
        agent_email: email_managed,
        agent_rol,
        agent_department,
        remote_agent
      };

      console.log(fieldsToUpdate);

      for (const [key, newValue] of Object.entries(fieldsToUpdate)) {
        const oldValue = agent[key];

        patchOps.push({
          op: oldValue === undefined ? 'add' : 'replace',
          path: `/${key}`,
          value: newValue
        });

        if (oldValue !== newValue) {
          detailedNotes.push({
            datetime: new Date().toISOString(),
            event_type: 'system_log',
            event: `Field '${key}' updated from '${oldValue}' to '${newValue}' by ${editor_email}`
          });
        }
      }

      detailedNotes.push({
        datetime: new Date().toISOString(),
        event_type: 'system_log',
        event: `Updated agent by ${editor_email}`
      });

      for (const note of detailedNotes) {
        patchOps.push({
          op: 'add',
          path: '/notes/-',
          value: note
        });
      }

      await item.patch(patchOps);

      return success('Agent updated successfully.');
    } catch (err) {
      context.log('Error updating agent:', err);
      return error('Error updating agent.', 500, err.message);
    }
  }
});