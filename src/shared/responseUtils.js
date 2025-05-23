function success(message, data = {}, status = 200) {
  return {
    status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      success: true,
      message,
      ...data
    })
  };
}

function error(message, status = 500, details = null, code = null) {
  const body = {
    success: false,
    message,
  };

  if (details) body.details = details;
  if (code) body.error_code = code;

  return {
    status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)  // 👈 Aseguramos que sea string
  };
}

function badRequest(message, details = null) {
  return error(message, 400, details);  // 👈 Devuelve JSON.stringify desde error()
}

function notFound(message = 'Recurso no encontrado', details = null) {
  return error(message, 404, details);  // 👈 También retorna string
}

function unauthorized(message = 'No autorizado') {
  return error(message, 401);  // 👈 Igual aquí
}

module.exports = {
  success,
  error,
  badRequest,
  notFound,
  unauthorized
};
