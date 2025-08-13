// src/functions/cosmoUpdateStatusQuality/index.js (CommonJS)
const { app } = require('@azure/functions');
const { getContainer } = require('../shared/cosmoClient');
const { getQAContainer } = require('../shared/cosmoQAClient');
const { success, badRequest, notFound, error } = require('../shared/responseUtils');

// 🔐 Auth utils
const { withAuth } = require('./auth/withAuth');
const { GROUPS } = require('./auth/groups.config');
const { getEmailFromClaims } = require('./auth/auth.helper');

// Grupo QUALITY
const { QUALITY: { QUALITY_GROUP } } = GROUPS;

const signalRUrl = process.env.SIGNAL_BROADCAST_URL2;
const signalRUrlStats = process.env.SIGNAL_BROADCAST_URL3;

app.http('cosmoUpdateStatusQuality', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  handler: withAuth(async (req, context) => {
    try {
      // 1) Claims del token
      const claims = context.user || {};
      const tokenGroups = Array.isArray(claims.groups) ? claims.groups : [];
      const agent_email = getEmailFromClaims(claims);
      if (!agent_email) {
        return { status: 401, jsonBody: { error: 'Email not found in token' } };
      }

      // Defensa en profundidad (además de groupsAny en withAuth)
      if (!tokenGroups.includes(QUALITY_GROUP)) {
        return { status: 403, jsonBody: { error: 'Insufficient group membership (Quality only)' } };
      }

      // 2) Body
      let body;
      try {
        body = await req.json();
      } catch {
        return badRequest('Invalid JSON.');
      }
      const { ticketId, newStatus } = body || {};
      if (!ticketId || !newStatus) {
        return badRequest('Missing parameters: ticketId or newStatus.');
      }

      // 3) Leer ticket
      const container = getContainer();
      const qcContainer = getQAContainer();

      const item = container.item(ticketId, ticketId);
      const { resource: ticket } = await item.read();
      if (!ticket) return notFound('Ticket not found.');

      if (ticket.status === newStatus) {
        return badRequest('New status is the same as the current one. No changes applied.');
      }

      // 4) Preparar patch (no cambiamos c.status aquí; sólo quality_control + nota)
      const quality_control = newStatus === 'QARevisionStart';
      const patchOps = [];

      if (!Array.isArray(ticket.notes)) {
        patchOps.push({ op: 'add', path: '/notes', value: [] });
      }
      patchOps.push({
        op: typeof ticket.quality_control === 'undefined' ? 'add' : 'replace',
        path: '/quality_control',
        value: quality_control
      });
      patchOps.push({
        op: 'add',
        path: '/notes/-',
        value: {
          datetime: new Date().toISOString(),
          event_type: 'system_log',
          agent_email,
          event: `Quality Control changed status: "${ticket.status || 'Unknown'}" → "${newStatus}"`
        }
      });

      await item.patch(patchOps);
      const { resource: updated } = await item.read();

      // 5) Crear/Eliminar en contenedor de QA
      if (quality_control) {
        await qcContainer.items.upsert({
          id: ticketId,
          ticketId,
          agent_email,
          creation_date: updated.creation_date,
          patient_name: updated.patient_name,
          patient_dob: updated.patient_dob,
          callback_number: updated.callback_number,
          caller_id: updated.caller_id,
          call_cost: updated.call_cost,
          call_duration: updated.call_duration,
          status: updated.status,
          agent_assigned: updated.agent_assigned,
          phone: updated.phone,
          aiClassification: updated.aiClassification,
          quality_control: updated.quality_control,
          linked_patient_snapshot: updated.linked_patient_snapshot,
          startDate: new Date().toISOString()
        });
      } else {
        // Si no está en QC, intentamos eliminar su entrada
        await qcContainer.item(ticketId, ticketId).delete().catch(e => {
          context.log('⚠️ Failed to delete QC entry:', e.message);
        });
      }

      // 6) Payload de respuesta / SignalR
      const responseData = {
        id: updated.id,
        summary: updated.summary,
        call_reason: updated.call_reason,
        creation_date: updated.creation_date,
        patient_name: updated.patient_name,
        patient_dob: updated.patient_dob,
        caller_name: updated.caller_name,
        callback_number: updated.callback_number,
        caller_id: updated.caller_id,
        call_cost: updated.call_cost,
        notes: updated.notes,
        collaborators: updated.collaborators,
        url_audio: updated.url_audio,
        assigned_department: updated.assigned_department,
        assigned_role: updated.assigned_role,
        caller_type: updated.caller_type,
        call_duration: updated.call_duration,
        status: updated.status,
        agent_assigned: updated.agent_assigned,
        tiket_source: updated.tiket_source,
        phone: updated.phone,
        work_time: updated.work_time,
        aiClassification: updated.aiClassification,
        quality_control: updated.quality_control,
        linked_patient_snapshot: updated.linked_patient_snapshot
      };

      const sendSignal = async (url) => {
        if (!url) return;
        try {
          await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(responseData)
          });
        } catch (e) {
          context.log(`⚠️ SignalR failed (${url}):`, e.message);
        }
      };
      await sendSignal(signalRUrl);
      await sendSignal(signalRUrlStats);

      return success('Status updated successfully.', { responseData });

    } catch (err) {
      context.log('❌ Error updating status (Quality):', err);
      return error('Internal Server Error', 500, err.message);
    }
  }, {
    // Debe ser un token válido con el scope de la API…
    scopesAny: ['access_as_user'],
    // …y pertenecer al grupo de QUALITY
    groupsAny: [QUALITY_GROUP],
  })
});
