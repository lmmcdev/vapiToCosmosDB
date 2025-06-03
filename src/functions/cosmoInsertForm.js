const { app } = require('@azure/functions');
const crypto = require('crypto');
const { getContainer } = require('../shared/cosmoClient');
const { success, error, badRequest } = require('../shared/responseUtils');
const dayjs = require('dayjs')

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
      return badRequest('Formato JSON inválido', err.message);
    }

    const form = body.form;

    // 2. Validar campos obligatorios
    const requiredFields = ['summary', 'patient_name', 'patient_dob', 'caller_id', 'agent_email'];
    const missingFields = requiredFields.filter(field => !form?.[field]);

    if (missingFields.length > 0) {
      return badRequest(`Faltan campos obligatorios: ${missingFields.join(', ')}`);
    }

    // 3. Preparar campos
    const date = new Date();
    const iso = date.toISOString();
    const creation_date = dayjs(iso).format('MM/DD/YYYY, HH:mm');

    
    const ticketId = crypto.randomUUID();
    const agent_assigned = "";
    const tiket_source = "Form";
    const collaborators = [];

    const summary = form.summary;
    const status = form.status?.trim() || "New";
    const patient_name = form.patient_name;
    const patient_dob = form.patient_dob;
    const phone = form.from_number;
    const caller_id = form.caller_id;
    const call_reason = form.call_reason;
    const agent_note = form.agent_note;
    const assigned_department = form.assigned_department;
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
      assigned_department,
      creation_date
    };

    try {
      const container = getContainer();

      // 6. Insertar en Cosmos DB
      const { resource } = await container.items.create(itemToInsert, {
        partitionKey: ticketId
      });

      return success('New ticket created successfully', { ticketId }, 201);

    } catch (err) {
      context.log('❌ Error inserting on CosmosDB:', err);
      return error('Error inserting in database', 500, err.message);
    }
  }
});
