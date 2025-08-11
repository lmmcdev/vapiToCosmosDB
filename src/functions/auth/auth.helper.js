// functions/auth/auth.helpers.js (CommonJS)

function toLowerSafe(s) {
  return (s || '').toString().toLowerCase();
}

function getEmailFromClaims(claims) {
  return toLowerSafe(
    claims?.preferred_username ||
    claims?.upn ||
    claims?.email ||
    ''
  );
}

/**
 * Devuelve:
 *  - isSupervisor: boolean
 *  - isAgent: boolean
 *  - role: 'supervisor' | 'agent' | null
 *
 * @param {object} claims - JWT claims del access token
 * @param {object} groupIds - { SUPERVISORS_GROUP, AGENTS_GROUP }
 */
function getRoleGroups(claims, { SUPERVISORS_GROUP, AGENTS_GROUP }) {
  const tokenGroups = Array.isArray(claims?.groups) ? claims.groups.map(toLowerSafe) : [];
  const supId = toLowerSafe(SUPERVISORS_GROUP);
  const agtId = toLowerSafe(AGENTS_GROUP);

  const isSupervisor = !!supId && tokenGroups.includes(supId);
  const isAgent      = !!agtId && tokenGroups.includes(agtId);

  const role = isSupervisor ? 'supervisor' : (isAgent ? 'agent' : null);
  return { isSupervisor, isAgent, role };
}

module.exports = {
  getEmailFromClaims,
  getRoleGroups,
};
