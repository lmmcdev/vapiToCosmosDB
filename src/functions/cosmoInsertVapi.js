const { app } = require('@azure/functions');
const crypto = require('crypto');
const { getContainer } = require('../shared/cosmoClient');
const { success, badRequest, error } = require('../shared/responseUtils');

app.http('cosmoInsertVapi', {
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    let body;

    // 1. Intentar parsear el cuerpo
    try {
      body = await request.json();
    } catch (err) {
      context.log('❌ Error parsing JSON:', err);
      return badRequest('Invalid JSON');
    }

    // 2. Validar estructura mínima
    if (!body?.message?.analysis?.summary || !body?.message?.call.createdAt) {
      return badRequest('Your request have missing parameters: summary o call_created_at');
    }

    const date = new Date();
    const ticketId = crypto.randomUUID();
    const status = "New";
    const agent_assigned = "";
    const tiket_source = "Phone";
    const collaborators = [];
    const notes = [{
      datetime: date.toISOString(),
      event_type: "system_log",
      event: "New ticket created"
    }];

    // 3. Campos estándar para el ticket
    const summary = body.message.analysis?.summary;
    const call_reason = body.message.analysis?.structuredData?.razon_llamada;
    const creation_date = body.message.call.createdAt;
    const patient_name = body.message.analysis?.structuredData?.nombreapellido_paciente;
    const patient_dob = body.message.analysis?.structuredData?.fechanacimiento_paciente;
    const caller_name = body.message.analysis?.structuredData?.nombreapellidos_familiar;
    const callback_number = body.message.analysis?.structuredData?.numero_alternativo;
    const phone = body.message.call?.customer?.number;
    const url_audio = body.message.stereoRecordingUrl;
    const caller_id = body.message.phoneNumber?.name;
    const call_cost = body.message.cost;
    const assigned_department = body.message.analysis?.structuredData?.vapi_assignment;
    const assigned_role = body.message.analysis?.structuredData?.assigned_role;
    const caller_type = body.message.analysis?.structuredData?.llamada;
    const call_duration = body.message.durationSeconds;

    // 4. Construcción del item para Cosmos DB
    const itemToInsert = {
      ...body,
      tickets: ticketId,
      id: ticketId,
      summary, call_reason, creation_date, patient_name,
      patient_dob, caller_name, callback_number, phone,
      url_audio, caller_id, call_cost, assigned_department,
      assigned_role, caller_type, call_duration,
      status,
      agent_assigned,
      tiket_source,
      collaborators,
      notes,
      timestamp: new Date().toISOString()
    };

    try {
      const container = getContainer();
      await container.items.create(itemToInsert, { partitionKey: ticketId });

      return success('Operation successfull', { tickets: ticketId }, 201);

    } catch (err) {
      context.log('❌ Error al insertar en Cosmos DB:', err);
      return error('Error creating ticket', 500, err.message);
    }
  }
});
