const { CosmosClient } = require("@azure/cosmos");

const endpoint = process.env.COSMOS_ENDPOINT;
const key = process.env.COSMOS_KEY;
const databaseId = process.env.COSMOS_DATABASE_ID;
const containerId = "quality_control_tickets";

const client = new CosmosClient({ endpoint, key });

const getQAContainer = () => {
  const database = client.database(databaseId);
  return database.container(containerId);
};

module.exports = { getQAContainer };