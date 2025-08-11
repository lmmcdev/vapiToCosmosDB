// auth/withAuth.js (CommonJS)
const { verifyAzureAdJwt } = require("./verifyJwt.js");

function getAuthHeader(req) {
  if (typeof req?.headers?.get === "function") {
    return req.headers.get("authorization") || req.headers.get("Authorization") || "";
  }
  return req?.headers?.authorization || req?.headers?.Authorization || "";
}

function withAuth(handler, routeOptions = {}) {
  return async (req, context) => {
    try {
      const hdr = getAuthHeader(req);
      const m = (hdr || "").match(/^Bearer\s+(.+)$/i);
      if (!m) return { status: 401, jsonBody: { error: "Missing Bearer token" } };

      const claims = await verifyAzureAdJwt(m[1].trim());

      const extraScopes = (routeOptions.scopes || []).filter(Boolean);
      const extraRoles  = (routeOptions.roles  || []).filter(Boolean);
      if (extraScopes.length || extraRoles.length) {
        const tokenScopes = (claims.scp || "").split(" ").map(s => s.trim()).filter(Boolean);
        const tokenRoles  = Array.isArray(claims.roles) ? claims.roles : [];
        const scopesOK = !extraScopes.length || extraScopes.some(s => tokenScopes.includes(s));
        const rolesOK  = !extraRoles.length  || extraRoles.some(r => tokenRoles.includes(r));
        if (!scopesOK || !rolesOK) return { status: 403, jsonBody: { error: "Insufficient permissions" } };
      }

      // ✅ SOLO en context; NO modificar req
      context.user = claims;

      return await handler(req, context);
    } catch (e) {
      const msg = e?.message || "Unauthorized";
      const code =
        msg === "Insufficient permissions" ? 403 :
        msg.startsWith("Token") || msg === "Invalid signature" ? 401 : 401;
      return { status: code, jsonBody: { error: msg } };
    }
  };
}

module.exports = { withAuth };
