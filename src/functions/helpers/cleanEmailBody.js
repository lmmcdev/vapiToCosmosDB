function cleanEmailBody(rawBody = "") {
  if (!rawBody || typeof rawBody !== "string") return "";

  let body = rawBody;

  // 1) Eliminar etiquetas HTML si el correo viene en HTML
  body = body.replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, "");  // quitar estilos
  body = body.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, ""); // quitar scripts
  body = body.replace(/<[^>]+>/g, ""); // quitar HTML

  // 2) Frases y patrones típicos que indican firma o disclaimer
  const cutMarkers = [
    "--", "___", "===",
    "Este mensaje y sus anexos", 
    "Aviso de Confidencialidad", 
    "Este correo electrónico puede contener información",
    "Confidentiality Notice",
    "This e-mail and any attachments",
    "DISCLAIMER",
    "Best regards", "Kind regards", "Regards", 
    "Saludos", "Atentamente",
    "Sent from my iPhone", "Enviado desde mi iPhone",
    "Sent from my Android", "Enviado desde mi dispositivo móvil"
  ];

  // Cortar el body al primer marcador que aparezca
  for (const marker of cutMarkers) {
    const idx = body.indexOf(marker);
    if (idx > -1) {
      body = body.substring(0, idx);
      break;
    }
  }

  // 3) Quitar URLs y teléfonos que suelen estar en firmas
  body = body.replace(/\bhttps?:\/\/\S+/gi, "");
  body = body.replace(/\+?\d[\d\s-]{7,}/g, "");

  // 4) Normalizar espacios y saltos de línea
  body = body
    .split("\n")
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .join("\n");

  // 5) Limitar tamaño en caso de cuerpos enormes
  if (body.length > 5000) {
    body = body.substring(0, 5000) + " ...[truncated]";
  }

  return body.trim();
}

module.exports = { cleanEmailBody };
