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
  const numericStatus = Number(status);
  if (isNaN(numericStatus) || numericStatus < 200 || numericStatus > 599) {
    throw new RangeError(`Invalid status code: ${status}`);
  }

  const body = {
    success: false,
    message,
  };

  if (details) body.details = details;
  if (code) body.error_code = code;

  return {
    status: numericStatus,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
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
