const { app } = require('@azure/functions');
const crypto = require('crypto');
const { getContainer } = require('../shared/cosmoClient');
const { success, badRequest, error } = require('../shared/responseUtils');

app.http('cosmoInsertRetel', {
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    let body;

    // 1. Intentar parsear el JSON
    try {
      body = await request.json();
    } catch (err) {
      context.log('❌ Error parsing JSON:', err);
      return badRequest('Invalid JSON');
    }

    // 2. Validar y extraer campos
    let data;
    try {
      data = body.call.call_analysis.custom_analysis_data;
    } catch (err) {
      return badRequest('Can not found node custom_analysis_data, error');
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

    const {
      summary,
      call_reason,
      patient_name,
      dob: patient_dob,
      caller_name,
      alternate_contact_number: callback_number,
      from_number: phone,
      recording_url: url_audio,
      agent_name: caller_id,
      assigned_department,
      assigned_role,
      caller_type
    } = data;

    const start_time = body.call?.start_timestamp;
    const call_cost_cent = body.call?.call_cost?.combined_cost;
    const call_duration = body.call?.call_cost?.total_duration_seconds;

    const call_cost = parseFloat((call_cost_cent/100).toFixed(4));
    //const call_cost = formatter.format(call_cost_centv);

    if (!summary || !call_reason || !start_time || !patient_name) {
      return badRequest('Your request have missing parameters');
    }

    const creation_date = new Date(start_time).toLocaleString('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });

    // 3. Armar item a insertar
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
      return error('Error, ticket not created', 500, err.message);
    }
  }
});
