// src/functions/dtos/providerSearch.dto.js
const Joi = require('joi');

/** Entrada */
const ProviderSearchInput = Joi.object({
  query: Joi.string().trim().min(1).required().label('query'),
  filter: Joi.string().allow('', null).optional().label('filter'),
  page: Joi.number().integer().min(1).default(1).label('page'),
  size: Joi.number().integer().min(1).max(200).default(50).label('size'),
});

/** Documento de salida (por cada resultado) */
const ProviderDoc = Joi.object({
  '@search.score': Joi.number().required(),
  id: Joi.string().required(),

  Provider_ID: Joi.alternatives().try(Joi.string().allow(''), Joi.number(), Joi.valid(null)).optional(),
  PhysID: Joi.string().allow('', null).optional(),
  ProvidOrg: Joi.string().allow('', null).optional(),
  First_Name: Joi.string().allow('', null).optional(),
  Last_Name: Joi.string().allow('', null).optional(),
  Title: Joi.string().allow('', null).optional(),
  Effective_To: Joi.string().allow('', null).optional(),
  Provider_Name: Joi.string().allow('', null).optional(),
  Office_Address: Joi.string().allow('', null).optional(),
  Office_City: Joi.string().allow('', null).optional(),
  Office_State: Joi.string().allow('', null).optional(),
  Office_Zip: Joi.string().allow('', null).optional(),
  Office_Phone: Joi.string().allow('', null).optional(),
  Office_Fax: Joi.string().allow('', null).optional(),
  Email: Joi.string().allow('', null).optional(),
  InHouse: Joi.string().allow('', null).optional(),
  Office_County_Name: Joi.string().allow('', null).optional(),
  Taxonomy_Code: Joi.string().allow('', null).optional(),
  Taxonomy_Description: Joi.string().allow('', null).optional(),
  Billing_Pay_To_Name: Joi.string().allow('', null).optional(),
  Billing_Pay_To_Organization: Joi.string().allow('', null).optional(),
  Billing_Pay_To_Address1: Joi.string().allow('', null).optional(),
  Billing_Pay_To_Address2: Joi.string().allow('', null).optional(),
  Billing_Pay_To_City: Joi.string().allow('', null).optional(),
  Billing_Pay_To_State: Joi.string().allow('', null).optional(),
  Billing_Pay_To_Zip: Joi.string().allow('', null).optional(),
  Billing_Pay_To_County: Joi.string().allow('', null).optional(),
});

/** Salida */
const ProviderSearchOutput = Joi.object({
  totalCount: Joi.number().integer().min(0).required(),
  page: Joi.number().integer().min(1).required(),
  size: Joi.number().integer().min(1).required(),
  results: Joi.array().items(ProviderDoc).required(),
});

/** Normalizador desde la respuesta de Azure Cognitive Search */
function mapProvidersResponseToDto(raw, page, size) {
  const totalCount =
    raw['@odata.count'] ??
    raw.count ??
    (Array.isArray(raw.value) ? raw.value.length : 0);

  const results = (raw.value || []).map((doc) => ({
    '@search.score': doc['@search.score'] ?? 0,
    id: doc.id ?? '',
    Provider_ID: doc.Provider_ID ?? null,
    PhysID: doc.PhysID ?? '',
    ProvidOrg: doc.ProvidOrg ?? '',
    First_Name: doc.First_Name ?? '',
    Last_Name: doc.Last_Name ?? '',
    Title: doc.Title ?? '',
    Effective_To: doc.Effective_To ?? '',
    Provider_Name: doc.Provider_Name ?? '',
    Office_Address: doc.Office_Address ?? '',
    Office_City: doc.Office_City ?? '',
    Office_State: doc.Office_State ?? '',
    Office_Zip: doc.Office_Zip ?? '',
    Office_Phone: doc.Office_Phone ?? '',
    Office_Fax: doc.Office_Fax ?? '',
    Email: doc.Email ?? '',
    InHouse: doc.InHouse ?? '',
    Office_County_Name: doc.Office_County_Name ?? '',
    Taxonomy_Code: doc.Taxonomy_Code ?? '',
    Taxonomy_Description: doc.Taxonomy_Description ?? '',
    Billing_Pay_To_Name: doc.Billing_Pay_To_Name ?? '',
    Billing_Pay_To_Organization: doc.Billing_Pay_To_Organization ?? '',
    Billing_Pay_To_Address1: doc.Billing_Pay_To_Address1 ?? '',
    Billing_Pay_To_Address2: doc.Billing_Pay_To_Address2 ?? '',
    Billing_Pay_To_City: doc.Billing_Pay_To_City ?? '',
    Billing_Pay_To_State: doc.Billing_Pay_To_State ?? '',
    Billing_Pay_To_Zip: doc.Billing_Pay_To_Zip ?? '',
    Billing_Pay_To_County: doc.Billing_Pay_To_County ?? '',
  }));

  return {
    totalCount: Number(totalCount) || 0,
    page,
    size,
    results,
  };
}

module.exports = {
  ProviderSearchInput,
  ProviderSearchOutput,
  mapProvidersResponseToDto,
};
