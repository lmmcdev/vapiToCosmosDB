const { CosmosClient } = require("@azure/cosmos");

const endpoint = process.env.COSMOS_ENDPOINT;
const key = process.env.COSMOS_KEY;
const databaseId = process.env.COSMOS_DATABASE_ID;
const containerId = "patients_id";

const client = new CosmosClient({ endpoint, key });

const getContainer = () => {
  const database = client.database(databaseId);
  return database.container(containerId);
};

module.exports = { getPatientsContainer };

