const { app } = require('@azure/functions');
const crypto = require('crypto');
const { getContainer } = require('../shared/cosmoClient');

app.http('cosmoInsertForm', {
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    let body;

    // 1. Intentar parsear el cuerpo del request
    try {
      body = await request.json();
    } catch (err) {
      context.log('❌ Error al parsear JSON:', err);
      return { status: 400, body: 'Formato JSON inválido' };
    }

    const form = body.form;

    // 2. Validar campos obligatorios
    const requiredFields = ['summary', 'patient_name', 'patient_dob', 'caller_id', 'agent_email'];
    const missingFields = requiredFields.filter(field => !form?.[field]);

    if (missingFields.length > 0) {
      return {
        status: 400,
        body: `Faltan campos obligatorios: ${missingFields.join(', ')}`
      };
    }

    // 3. Preparar campos
    const date = new Date();
    const ticketId = crypto.randomUUID();
    const agent_assigned = "";
    const tiket_source = "Form";
    const collaborators = [];

    const summary = form.summary;
    const status = form.status?.trim() || "New"; // Si no hay status, se pone "new"
    const patient_name = form.patient_name;
    const patient_dob = form.patient_dob;
    const phone = form.from_number;
    const caller_id = form.caller_id;
    const call_reason = form.call_reason;
    const agent_note = form.agent_note;

    // 4. Generar notas
    const notes = [
      {
        datetime: date.toISOString(),
        event_type: "system_log",
        event: `New ticket created by ${form.agent_email}`
      }
    ];

    if (agent_note) {
      notes.push({
        datetime: date.toISOString(),
        event_type: "user_log",
        event: agent_note
      });
    }

    // 5. Ensamblar documento a insertar
    const itemToInsert = {
        tickets: ticketId,
        id: ticketId,
        agent_assigned,
        tiket_source,
        collaborators,
        notes,
        timestamp: new Date().toISOString(),
        summary,
        status,
        patient_name,
        patient_dob,
        phone,
        caller_id,
        call_reason,
    };

    try {
      const container = getContainer();

      // 6. Insertar en Cosmos DB usando la clave de partición correcta
      const { resource } = await container.items.create(itemToInsert, {
        partitionKey: ticketId
      });

      return {
        status: 201,
        body: {
          message: 'New ticket created successfully',
          tickets: JSON.stringify(ticketId)
        }
      };

    } catch (error) {
      context.log('❌ Error inserting on CosmosDB:', error);
      return {
        status: 500,
        body: `Error inserting in database: ${error.message}`
      };
    }
  }
});
