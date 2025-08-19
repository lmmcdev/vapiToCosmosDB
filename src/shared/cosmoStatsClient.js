const { CosmosClient } = require("@azure/cosmos");

const endpoint = process.env.COSMOS_ENDPOINT;
const key = process.env.COSMOS_KEY;
const databaseId = process.env.COSMOS_DATABASE_ID;
const containerId = process.env.COSMOS_STATS_CONTAINER_ID;

const client = new CosmosClient({ endpoint, key });

const getStatsContainer = () => {
  const database = client.database(databaseId);
  return database.container(containerId);
};

module.exports = { getStatsContainer };

