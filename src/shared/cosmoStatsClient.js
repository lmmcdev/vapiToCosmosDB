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

//LOCALHOST
/*const { CosmosClient } = require("@azure/cosmos");

const endpoint = "https://lmmccosmos02.documents.azure.com:443/";
const key = ""; // la clave primaria

const client = new CosmosClient({
  endpoint,
  key
});

const getStatsContainer = () => {
  const db = client.database("IAData");
  return db.container("tickets_stats");
};
module.exports = { getStatsContainer };*/
