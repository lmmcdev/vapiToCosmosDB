// helpers/ticketAuth.js
const lc = (s) => (s || '').toLowerCase();

/**
 * Verifica si el usuario puede modificar un ticket.
 * Se permite si:
 *  - es supervisor
 *  - es el agente asignado
 *  - es colaborador actual
 *
 * @param {object} ticket - documento del ticket de Cosmos
 * @param {string} actorEmail - email del usuario logueado (normalizado a lowercase)
 * @param {boolean} isSupervisor - true si el usuario está en grupo supervisor
 * @returns {boolean} true si puede modificar, false si no
 */
function canModifyTicket(ticket, actorEmail, isSupervisor = false) {
  if (!ticket || !actorEmail) return false;

  const me = lc(actorEmail);
  const assigned = lc(ticket.agent_assigned);
  const collaborators = Array.isArray(ticket.collaborators)
    ? ticket.collaborators.map(lc)
    : [];

  return (
    isSupervisor ||
    (assigned && assigned === me) ||
    collaborators.includes(me)
  );
}

module.exports = { canModifyTicket };
