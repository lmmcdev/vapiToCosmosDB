const jwt = require("jsonwebtoken");
const jwksClient = require("jwks-rsa");
const util = require("util");

// Configuración según tu App Registration
const tenantId = "7313ad10-b885-4b50-9c75-9dbbd975618f";
const clientId = "08e5a940-4349-45b0-94ce-46505e0a99a3";

const client = jwksClient({
  jwksUri: `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`,
});

function getKey(header, callback) {
  client.getSigningKey(header.kid, (err, key) => {
    if (err) {
      callback(err, null);
      return;
    }
    const signingKey = key.getPublicKey();
    callback(null, signingKey);
  });
}

// Middleware para proteger Azure Functions
const withAuth = (handler) => {
  return async function (context, req) {
    // Accede al header authorization directamente desde req.headers
    const authHeader = req.headers?.authorization || req.headers?.Authorization;
    console.log("Headers recibidos:", req.headers);
    console.log(util.inspect(req, { showHidden: false, depth: null }));

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      context.res = {
        status: 401,
        body: "Token no proporcionado",
      };
      return; // Termina aquí para no continuar
    }

    const token = authHeader.split(" ")[1];

    try {
      const decoded = await new Promise((resolve, reject) => {
        jwt.verify(
          token,
          getKey,
          {
            audience: clientId,
            issuer: `https://login.microsoftonline.com/${tenantId}/v2.0`,
          },
          (err, decoded) => {
            if (err) reject(err);
            else resolve(decoded);
          }
        );
      });

      // Guarda el usuario decodificado en context.user para usarlo en el handler
      context.user = decoded;

      // Ejecuta la función protegida
      return await handler(context, req);

    } catch (error) {
      context.res = {
        status: 403,
        body: "Token inválido: " + error.message,
      };
      return;
    }
  };
};

module.exports = withAuth;
