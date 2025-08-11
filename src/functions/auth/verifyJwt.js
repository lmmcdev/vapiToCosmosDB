//const API_AUDIENCE = "aeec4f18-85f7-4c67-8498-39d4af1440c1";
// auth/verifyJwt.js
// Node 18+ (WebCrypto + fetch). Sin dependencias externas.

const { webcrypto } = require("crypto");
// TextEncoder es global en Node 18+, pero por compat:
const { TextEncoder } = require("util");

const TENANT_ID = "7313ad10-b885-4b50-9c75-9dbbd975618f";
const API_AUDIENCE_GUID = "aeec4f18-85f7-4c67-8498-39d4af1440c1";
const API_AUDIENCE_URI  = "api://aeec4f18-85f7-4c67-8498-39d4af1440c1";
const ALLOWED_AUDIENCES = [API_AUDIENCE_GUID, API_AUDIENCE_URI];
const REQUIRED_SCOPES = ["access_as_user"];
const REQUIRED_APP_ROLES = [];
const CLOCK_SKEW_SEC = 300;

const ISS_V2 = (tid) => `https://login.microsoftonline.com/${tid}/v2.0`;
const ISS_V1 = (tid) => `https://sts.windows.net/${tid}/`;

function jwksUriForIssuer(iss, tid) {
  const base = `https://login.microsoftonline.com/${tid}/discovery`;
  return iss.includes("sts.windows.net") ? `${base}/keys` : `${base}/v2.0/keys`;
}

const textEncoder = new TextEncoder();
let jwksCache = { byKid: new Map(), expiresAt: 0, keysUri: null };

function b64urlToUint8Array(b64url) {
  const pad = "=".repeat((4 - (b64url.length % 4)) % 4);
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/") + pad;
  return Uint8Array.from(Buffer.from(b64, "base64"));
}

function parseJwt(token) {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid JWT format");
  const [h, p, s] = parts;
  const header = JSON.parse(Buffer.from(h, "base64url").toString("utf8"));
  const payload = JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
  const signature = b64urlToUint8Array(s);
  return { headerB64: h, payloadB64: p, signature, header, payload };
}

async function getJwkForKid(keysUri, kid) {
  const now = Date.now();
  const mustReload = !jwksCache.byKid.size || jwksCache.expiresAt < now || jwksCache.keysUri !== keysUri;
  if (mustReload) {
    const resp = await fetch(keysUri);
    if (!resp.ok) throw new Error("Unable to fetch JWKS");
    const { keys } = await resp.json();
    jwksCache.byKid.clear();
    for (const k of keys || []) if (k.kid) jwksCache.byKid.set(k.kid, k);
    jwksCache.expiresAt = now + 60 * 60 * 1000;
    jwksCache.keysUri = keysUri;
  }
  const jwk = jwksCache.byKid.get(kid);
  if (!jwk) throw new Error("Signing key (kid) not found in JWKS");
  return jwk;
}

async function importPublicKeyFromJwk(jwk) {
  return await webcrypto.subtle.importKey(
    "jwk",
    { ...jwk, ext: true },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );
}

function assertTimeClaims(payload, skewSec) {
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === "number" && now > payload.exp + skewSec) throw new Error("Token expired");
  if (typeof payload.nbf === "number" && now + skewSec < payload.nbf) throw new Error("Token not yet valid");
}

function assertIssuer(iss, tid) {
  const ok = iss === ISS_V2(tid) || iss === ISS_V1(tid);
  if (!ok) throw new Error("Invalid issuer");
}

function assertAudience(aud, allowed) {
  if (!allowed.includes(aud)) throw new Error("Invalid audience");
}

function assertPermissions(payload, requiredScopes, requiredRoles) {
  const needScopes = (requiredScopes || []).filter(Boolean);
  const needRoles = (requiredRoles || []).filter(Boolean);
  if (!needScopes.length && !needRoles.length) return;
  const tokenScopes = (payload.scp || "").split(" ").map(s => s.trim()).filter(Boolean);
  const tokenRoles = Array.isArray(payload.roles) ? payload.roles : [];
  const scopesOK = !needScopes.length || needScopes.some(s => tokenScopes.includes(s));
  const rolesOK  = !needRoles.length  || needRoles.some(r => tokenRoles.includes(r));
  if (!scopesOK || !rolesOK) throw new Error("Insufficient permissions");
}

async function verifyAzureAdJwt(token) {
  if (!TENANT_ID) throw new Error("TENANT_ID is required");
  const { headerB64, payloadB64, signature, header, payload } = parseJwt(token);
  assertTimeClaims(payload, CLOCK_SKEW_SEC);
  assertIssuer(payload.iss, TENANT_ID);
  assertAudience(payload.aud, ALLOWED_AUDIENCES);
  const keysUri = jwksUriForIssuer(payload.iss, TENANT_ID);
  const jwk = await getJwkForKid(keysUri, header.kid);
  const key = await importPublicKeyFromJwk(jwk);
  const signed = textEncoder.encode(`${headerB64}.${payloadB64}`);
  const ok = await webcrypto.subtle.verify({ name: "RSASSA-PKCS1-v1_5" }, key, signature, signed);
  if (!ok) throw new Error("Invalid signature");
  assertPermissions(payload, REQUIRED_SCOPES, REQUIRED_APP_ROLES);
  return payload;
}

module.exports = { verifyAzureAdJwt };

