// auth/withAuth.js (CommonJS)
const { verifyAzureAdJwt } = require("./verifyJwt.js");

function getAuthHeader(req) {
  if (typeof req?.headers?.get === "function") {
    return req.headers.get("authorization") || req.headers.get("Authorization") || "";
  }
  return req?.headers?.authorization || req?.headers?.Authorization || "";
}

/**
 * routeOptions:
 *  - scopesAny?: string[]   -> requiere al menos 1 scope (si se especifica)
 *  - rolesAny?: string[]    -> pasa si tiene alguno de estos roles
 *  - groupsAny?: string[]   -> pasa si pertenece a alguno de estos grupos
 *  - groupsAll?: string[]   -> además, debe pertenecer a todos estos grupos
 *  - mode?: 'or' | 'and'    -> cómo combinar roles y grupos (default: 'or')
 *  - allow?: (claims, req) => boolean | Promise<boolean>  -> predicado extra opcional
 */
function withAuth(handler, routeOptions = {}) {
  const {
    scopesAny = [],
    rolesAny = [],
    groupsAny = [],
    groupsAll = [],
    mode = "or",
    allow = null,
  } = routeOptions;

  return async (req, context) => {
    try {
      const hdr = getAuthHeader(req);
      const m = (hdr || "").match(/^Bearer\s+(.+)$/i);
      if (!m) return { status: 401, jsonBody: { error: "Missing Bearer token" } };

      const token = m[1].trim();
      const claims = await verifyAzureAdJwt(token);

      // ---- Scopes (si se piden, son obligatorios) ----
      if (Array.isArray(scopesAny) && scopesAny.length > 0) {
        const tokenScopes = (claims.scp || "").split(" ").map(s => s.trim()).filter(Boolean);
        const scopeOK = scopesAny.some(s => tokenScopes.includes(s));
        if (!scopeOK) {
          return { status: 403, jsonBody: { error: "Insufficient scope" } };
        }
      }

      // ---- Roles ----
      let rolesOK = true; // si no se piden roles, no bloquea
      if (Array.isArray(rolesAny) && rolesAny.length > 0) {
        const tokenRoles = Array.isArray(claims.roles) ? claims.roles : [];
        rolesOK = rolesAny.some(r => tokenRoles.includes(r));
      }

      // ---- Grupos ----
      let groupsOK = true; // si no se piden grupos, no bloquea
      const needGroups = (groupsAny && groupsAny.length) || (groupsAll && groupsAll.length);
      if (needGroups) {
        const tokenGroups = Array.isArray(claims.groups) ? claims.groups : [];
        const groupsOverage = !tokenGroups.length && claims._claim_names && claims._claim_names.groups;

        // Si pides grupos y no vienen en el token:
        // - en modo OR, solo deniega si además rolesOK es falso (porque no hay otra vía de pase)
        // - en modo AND, deniega siempre porque falta el componente grupos
        if (groupsOverage) {
          const canPassViaRoles = (mode === 'or') && rolesOK && (rolesAny && rolesAny.length);
          if (!canPassViaRoles) {
            return { status: 403, jsonBody: { error: "Group overage: groups not in token" } };
          }
        } else {
          const anyOK = !groupsAny?.length || groupsAny.some(g => tokenGroups.includes(g));
          const allOK = !groupsAll?.length || groupsAll.every(g => tokenGroups.includes(g));
          groupsOK = anyOK && allOK;
        }
      }

      // ---- Combinar roles/grupos ----
      const gatesConfigured = (rolesAny && rolesAny.length) || needGroups;
      if (gatesConfigured) {
        const permsOK = (mode === "and") ? (rolesOK && groupsOK) : (rolesOK || groupsOK);
        if (!permsOK) {
          return { status: 403, jsonBody: { error: "Insufficient permissions" } };
        }
      }

      // ---- Predicado extra opcional ----
      if (typeof allow === "function") {
        const allowed = await Promise.resolve(allow(claims, req));
        if (!allowed) {
          return { status: 403, jsonBody: { error: "Insufficient permissions" } };
        }
      }

      // Adjunta claims SOLO en context (no tocar req)
      context.user = claims;

      return await handler(req, context);
    } catch (e) {
      const msg = e?.message || "Unauthorized";
      const code =
        msg === "Insufficient permissions" ? 403 :
        msg === "Insufficient scope" ? 403 :
        msg.startsWith("Token") || msg === "Invalid signature" ? 401 : 401;
      return { status: code, jsonBody: { error: msg } };
    }
  };
}

module.exports = { withAuth };
