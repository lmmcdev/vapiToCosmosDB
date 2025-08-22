// helpers/time.helper.js (CommonJS, sin dependencias externas)

/**
 * Obtiene el offset en minutos de un timeZone IANA para un instante dado.
 * Técnica: formatear partes en la zona objetivo y reconstruir un UTC "equivalente",
 * la diferencia con el timestamp real es el offset de esa zona.
 */
function getTimeZoneOffsetMinutes(date = new Date(), timeZone = 'America/New_York') {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });

  const parts = dtf.formatToParts(date).reduce((acc, p) => {
    acc[p.type] = p.value;
    return acc;
  }, {});

  const year   = Number(parts.year);
  const month  = Number(parts.month);
  const day    = Number(parts.day);
  const hour   = Number(parts.hour);
  const minute = Number(parts.minute);
  const second = Number(parts.second);

  // “asUTC” interpreta esos componentes como si fueran UTC
  const asUTCms = Date.UTC(year, month - 1, day, hour, minute, second, date.getMilliseconds());
  const realMs  = date.getTime();

  // Diferencia positiva => zona va ADELANTADA respecto de UTC (offset negativo típico de Américas dará < 0)
  const offsetMinutes = Math.round((asUTCms - realMs) / 60000);
  return offsetMinutes;
}

/** Zero-pad */
const zp = (n, len = 2) => String(n).padStart(len, '0');

/**
 * Crea un ISO 8601 local para la zona (con offset ±HH:MM).
 * Ej: 2025-08-22T10:23:45.123-04:00
 */
function formatZonedISO(date = new Date(), timeZone = 'America/New_York') {
  const offsetMin = getTimeZoneOffsetMinutes(date, timeZone);

  // Obtener los componentes "vistos" en la zona usando Intl
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  const parts = dtf.formatToParts(date).reduce((acc, p) => {
    acc[p.type] = p.value;
    return acc;
  }, {});

  const year   = parts.year;
  const month  = parts.month;
  const day    = parts.day;
  const hour   = parts.hour;
  const minute = parts.minute;
  const second = parts.second;
  const ms     = zp(date.getMilliseconds(), 3);

  const sign   = offsetMin <= 0 ? '+' : '-'; // Ojo: offsetMin es asUTC - real => para ISO invertimos el signo
  const absMin = Math.abs(offsetMin);
  const offHH  = zp(Math.floor(absMin / 60));
  const offMM  = zp(absMin % 60);

  return `${year}-${month}-${day}T${hour}:${minute}:${second}.${ms}${sign}${offHH}:${offMM}`;
}

/**
 * Crea una cadena para UI en el locale dado (ej. 'es-419' o 'en-US'),
 * con zona horaria nombre corto (EDT/EST o GMT-4 según el locale).
 * Ej (es-419): "22 ago 2025, 10:23 a. m. EDT"
 */
function formatZonedDisplay(date = new Date(), timeZone = 'America/New_York', locale = 'es-419') {
  const fmt = new Intl.DateTimeFormat(locale, {
    timeZone,
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: undefined, // UI suele no necesitar segundos
    hour12: true,
    timeZoneName: 'short',
  });
  return fmt.format(date);
}

/**
 * Helper genérico para cualquier zona
 */
function getNowForTZ({ timeZone = 'America/New_York', locale = 'es-419' } = {}) {
  const now = new Date();
  return {
    dateISO: formatZonedISO(now, timeZone),
    dateDisplay: formatZonedDisplay(now, timeZone, locale),
  };
}

/**
 * Alias específico para Miami (America/New_York).
 */
function getMiamiNow(locale = 'es-419') {
  return getNowForTZ({ timeZone: 'America/New_York', locale });
}

module.exports = {
  getTimeZoneOffsetMinutes,
  formatZonedISO,
  formatZonedDisplay,
  getNowForTZ,
  getMiamiNow,
};
