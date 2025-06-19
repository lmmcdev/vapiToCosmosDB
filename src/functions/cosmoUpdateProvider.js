const { app } = require('@azure/functions');
const { getProviderContainer } = require('../shared/cosmoProvidersClient');
const { success, badRequest, notFound, error } = require('../shared/responseUtils');

app.http('cosmoUpdateProvider', {
  methods: ['PATCH'],
  authLevel: 'anonymous',
  handler: async (req, context) => {
    let id, updates;

    try {
      ({ id, ...updates } = await req.json());
    } catch (err) {
      return badRequest('Invalid JSON.');
    }

    if (!id || typeof updates !== 'object') {
      return badRequest('Missing or invalid provider ID.');
    }

    const container = getProviderContainer();
    const item = container.item(id, id); // 🔑 Clave de partición es el campo "id"

    try {
      const { resource: provider } = await item.read();
      if (!provider) return notFound('Provider not found.');

      const patchOps = [];

      const updatableFields = [
        "ProvidOrg",
        "First_Name",
        "Last_Name",
        "Title",
        "Effective_To",
        "Provider_Name",
        "Office_Address",
        "Office_City",
        "Office_State",
        "Office_Zip",
        "Office_Phone",
        "Office_Fax",
        "Email",
        "InHouse",
        "Office_County_Name",
        "Taxonomy_Code",
        "Taxonomy_Description",
        "Billing_Pay_To_Name",
        "Billing_Pay_To_Organization",
        "Billing_Pay_To_Address1",
        "Billing_Pay_To_Address2",
        "Billing_Pay_To_City",
        "Billing_Pay_To_State",
        "Billing_Pay_To_Zip",
        "Billing_Pay_To_County"
      ];

      for (const key of updatableFields) {
        if (updates[key] !== undefined) {
          patchOps.push({
            op: provider[key] !== undefined ? 'replace' : 'add',
            path: `/${key}`,
            value: updates[key]
          });
        }
      }

      if (patchOps.length === 0) {
        return badRequest('No valid fields to update.');
      }

      // ⚙️ Aplica patch en bloques de 10
      const chunkSize = 10;
      for (let i = 0; i < patchOps.length; i += chunkSize) {
        const chunk = patchOps.slice(i, i + chunkSize);
        await item.patch(chunk);
      }

      return success('Provider updated successfully.', {
        id,
        applied_operations: patchOps.length
      });

    } catch (err) {
      context.log('❌ Error updating provider:', err);
      return error('Internal Server Error', 500, err.message);
    }
  }
});
