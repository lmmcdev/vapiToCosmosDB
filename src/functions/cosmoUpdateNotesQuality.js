// src/functions/cosmoUpdateNotesQuality/index.js (CommonJS)
const { app } = require('@azure/functions');
const { getContainer } = require('../shared/cosmoClient');
const { success, badRequest, notFound, error } = require('../shared/responseUtils');

// 🔐 Auth utils
const { withAuth } = require('./auth/withAuth');
const { GROUPS } = require('./auth/groups.config');
const { getEmailFromClaims } = require('./auth/auth.helper');
const { getMiamiNow } = require('./helpers/timeHelper');


// Grupo QUALITY (acceso exclusivo)
const { QUALITY: { QUALITY_GROUP } } = GROUPS;

//const signalRUrl = process.env.SIGNAL_BROADCAST_URL2;

app.http('cosmoUpdateNotesQuality', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  handler: withAuth(async (req, context) => {
    try {
      const { dateISO: miamiUTC } = getMiamiNow();

      // 1) Claims: email y grupos desde el token
      const claims = context.user || {};
      const tokenGroups = Array.isArray(claims.groups) ? claims.groups : [];
      const agent_email = getEmailFromClaims(claims);
      if (!agent_email) {
        return { status: 401, jsonBody: { error: 'Email not found in token' } };
      }
      // Defensa adicional (además de groupsAny en wrapper)
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
      const { ticketId, notes, event } = body || {};
      if (!ticketId) return badRequest('Missing parameter: ticketId.');
      if (!Array.isArray(notes) && !event) {
        return badRequest('Provide at least "notes" (array) and/or "event" (string).');
      }
      if (Array.isArray(notes)) {
        for (let i = 0; i < notes.length; i++) {
          const n = notes[i];
          if (!n || typeof n !== 'object' || typeof n.event !== 'string' || !n.event.trim()) {
            return badRequest(`Invalid note at index ${i}: must include non-empty "event" string.`);
          }
        }
      }

      // 3) Leer ticket
      const ticketContainer = getContainer();
      const ticketItem = ticketContainer.item(ticketId, ticketId);
      const { resource: ticket } = await ticketItem.read();
      if (!ticket) return notFound('Ticket not found.');

      // 4) Construir patchOps (todas las notas como 'quality_note')
      const patchOps = [];
      if (!Array.isArray(ticket.notes)) {
        patchOps.push({ op: 'add', path: '/notes', value: [] });
      }

      let addedCount = 0;

      if (Array.isArray(notes) && notes.length > 0) {
        for (const n of notes) {
          patchOps.push({
            op: 'add',
            path: '/notes/-',
            value: {
              datetime: miamiUTC,
              event_type: 'quality_note',
              agent_email,         // del token
              event: n.event.trim()
            }
          });
          addedCount++;
        }
        // Resumen de sistema
        patchOps.push({
          op: 'add',
          path: '/notes/-',
          value: {
            datetime: miamiUTC,
            event_type: 'system_log',
            agent_email,
            event: `Added ${notes.length} quality note(s).`
          }
        });
      }

      if (event && typeof event === 'string' && event.trim()) {
        patchOps.push({
          op: 'add',
          path: '/notes/-',
          value: {
            datetime: miamiUTC,
            event_type: 'system_log',
            agent_email,
            event: event.trim()
          }
        });
        addedCount++;
      }

      if (patchOps.length === 0) {
        return badRequest('No valid operations to apply.');
      }

      // 5) Aplicar patch y releer
      await ticketItem.patch(patchOps);
      const { resource: updated } = await ticketItem.read();

      // 6) Payload de respuesta y SignalR
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

      /*try {
        if (signalRUrl) {
          await fetch(signalRUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(responseData)
          });
        }
      } catch (e) {
        context.log('⚠️ SignalR failed:', e.message);
      }*/

      return success('Notes updated successfully.', { added: addedCount, ticket: responseData });
    } catch (err) {
      context.log('❌ Error updating quality notes:', err);
      return error('Internal Server Error', 500, err.message);
    }
  }, {
    // Requiere scope de la API…
    scopesAny: ['access_as_user'],
    // …y pertenecer al grupo QUALITY
    groupsAny: [QUALITY_GROUP],
  })
});
