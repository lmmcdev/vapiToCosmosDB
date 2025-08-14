// ./dtos/patientSearch.dto.js
const Joi = require('joi');

// ===== DTO de ENTRADA =====
const PatientSearchInput = Joi.object({
  query: Joi.string().trim().min(1).required().label('query'),
  filter: Joi.string().trim().allow('', null).optional().label('filter'),
  page: Joi.number().integer().min(1).default(1).label('page'),
  size: Joi.number().integer().min(1).max(100).default(50).label('size'),
});

// ===== DTO de CADA RESULTADO =====
const PatientSearchHit = Joi.object({
  '@search.score': Joi.number().required(),
  id: Joi.string().required(),

  // Campos del índice (permitimos vacío)
  Contact_Information: Joi.string().allow('').required(),
  Name: Joi.string().allow('').required(),
  DOB: Joi.string().allow('').required(),           // puede venir en ISO o vacío
  PatientNumber: Joi.string().allow('').required(),
  Email: Joi.string().allow('').required(),
  Gender: Joi.string().allow('').required(),
  Language: Joi.string().allow('').required(),
  PCP: Joi.string().allow('').required(),
  Age: Joi.alternatives().try(Joi.string(), Joi.number()).required(),
  Location_Name: Joi.string().allow('').required(),
}).unknown(true); // si el índice devuelve más campos, no falle

// ===== DTO de SALIDA =====
const PatientSearchOutput = Joi.object({
  count: Joi.number().integer().min(0).required(),
  page: Joi.number().integer().min(1).required(),
  size: Joi.number().integer().min(1).required(),
  hits: Joi.array().items(PatientSearchHit).required(),
});

// ===== Normalizador de la respuesta de Cognitive Search a nuestro DTO =====
function mapSearchResponseToDto(raw, page, size) {
  const count = raw['@odata.count'] ?? raw.count ?? 0;
  const value = Array.isArray(raw.value) ? raw.value : [];

  const hits = value.map((v) => ({
    '@search.score': v['@search.score'],
    id: v.id ?? '',

    Contact_Information: v.Contact_Information ?? '',
    Name: v.Name ?? '',
    DOB: v.DOB ?? '',
    PatientNumber: v.PatientNumber ?? '',
    Email: v.Email ?? '',
    Gender: v.Gender ?? '',
    Language: v.Language ?? '',
    PCP: v.PCP ?? '',
    Age: v.Age ?? v.age ?? '',
    Location_Name: v.Location_Name ?? '',
  }));

  return {
    count: Number(count) || 0,
    page,
    size,
    hits,
  };
}

module.exports = {
  PatientSearchInput,
  PatientSearchHit,
  PatientSearchOutput,
  mapSearchResponseToDto,
};
