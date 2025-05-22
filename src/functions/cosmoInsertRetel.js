const { app } = require('@azure/functions');
const crypto = require('crypto');
const { getContainer } = require('../shared/cosmoClient');

app.http('cosmoInsertRetel', {
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
    let summary = body.call.call_analysis.custom_analysis_data.summary;
    let call_reason = body.call.call_analysis.custom_analysis_data.call_reason;
    let start_time = body.call.start_timestamp;
    let patient_name = body.call.call_analysis.custom_analysis_data.patient_name;
    let patient_dob = body.call.call_analysis.custom_analysis_data.dob;
    let caller_name = body.call.call_analysis.custom_analysis_data.caller_name;
    let callback_number = body.call.call_analysis.custom_analysis_data.alternate_contact_number;
    let phone = body.call.call_analysis.custom_analysis_data.from_number;
    let url_audio = body.call.call_analysis.custom_analysis_data.recording_url;
    let caller_id = body.call.call_analysis.custom_analysis_data.agent_name;
    let call_cost = body.call.call_cost.combined_cost; //aclarar con Erika como lo dan aqui el costo de la llamada
    let assigned_department = body.call.call_analysis.custom_analysis_data.assigned_department;
    let assigned_role = body.call.call_analysis.custom_analysis_data.assigned_role;
    let caller_type = body.call.call_analysis.custom_analysis_data.caller_type;
    let call_duration = body.call.call_cost.total_duration_seconds;

    const creation_date = new Date(start_time).toLocaleString('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    // 3. Combinar ticket UUID al documento recibido
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

      // 4. Insertar en Cosmos DB usando la clave de partición correcta
      const { resource } = await container.items.create(
        itemToInsert,
        { partitionKey: ticketId } // 🔑 importante: este debe coincidir con `tickets`
      );

      // 5. Respuesta de éxito
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
