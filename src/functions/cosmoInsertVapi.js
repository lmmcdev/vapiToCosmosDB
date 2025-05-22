const { app } = require('@azure/functions');
const crypto = require('crypto');
const { getContainer } = require('../shared/cosmoClient');

app.http('cosmoInsertVapi', {
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

    // 2. Captura de campos para compatibilizar los tickets entre vapi y retel
    //Campos agregados
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

    //campos standares de los tickets (ponerlos en el nivel raiz del json)
    let summary = body.message.summary;
    let call_reason = body.message.analysis.structuredData.razon_llamada;
    let creation_date = body.message.call_created_at;
    let patient_name = body.message.analysis.structuredData.nombreapellidos_paciente;
    let patient_dob = body.message.analysis.structuredData.fechanacimiento_paciente;
    let caller_name = body.message.analysis.structuredData.nombreapellidos_familiar;
    let callback_number = body.message.analysis.structuredData.numero_alternativo;
    let phone = body.message.call.customer.number;
    let url_audio = body.message.stereoRecordingUrl;
    let caller_id = body.message.phoneNumber.name;
    let call_cost = body.message.cost;
    let assigned_department = body.message.analysis.structuredData.vapi_assignment;
    let assigned_role = body.message.analysis.structuredData.assigned_role;
    let caller_type = body.message.analysis.structuredData.llamada;
    let call_duration = body.message.duration_minutes;


    // 4. Combinar valores y construir el documento a insertar
    const itemToInsert = {
      ...body,
      tickets: ticketId,
      id: ticketId,
      summary, call_reason, creation_date, patient_name,
      patient_dob,caller_name,callback_number,phone,
      url_audio,caller_id,call_cost,assigned_department,
      assigned_role,caller_type,call_duration,
      status,
      agent_assigned,
      tiket_source,
      collaborators,
      notes,
      timestamp: new Date().toISOString()
    };

    try {
      const container = getContainer();

      const { resource } = await container.items.create(
        itemToInsert,
        { partitionKey: ticketId }
      );

      return {
        status: 201,
        body: {
          message: 'Item insertado correctamente',
          tickets: JSON.stringify(ticketId)
        }
      };

    } catch (error) {
      context.log('❌ Error al insertar en Cosmos DB:', error);
      return {
        status: 500,
        body: `Error al insertar en la base de datos: ${error.message}`
      };
    }
  }
});
