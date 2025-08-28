// auth/resolveUserDepartment.js
const { GROUPS } = require('../auth/groups.config');

function toLowerSafe(x) {
  return typeof x === 'string' ? x.toLowerCase() : '';
}

/**
 * Resuelve el departamento y rol del usuario según sus claims.
 *
 * @param {object} claims - JWT claims del token (contiene .groups[])
 * @returns {object} { department: string|null, role: string|null, groupId: string|null }
 */
function resolveUserDepartment(claims) {
  const tokenGroups = Array.isArray(claims?.groups) ? claims.groups.map(toLowerSafe) : [];

  for (const [location, roles] of Object.entries(GROUPS)) {
    for (const [role, groupId] of Object.entries(roles)) {
      if (tokenGroups.includes(toLowerSafe(groupId))) {
        return {
          location,   // ej. "SWITCHBOARD"
          role,         // ej. "SUPERVISORS" | "AGENTS" | "ACCESS"
          groupId,      // el GUID original
        };
      }
    }
  }

  return { location: null, role: null, groupId: null };
}

module.exports = { resolveUserDepartment };
