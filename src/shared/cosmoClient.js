const { CosmosClient } = require('@azure/cosmos');

const endpoint = process.env["https://lmmccosmos01.documents.azure.com:443/"];
const key = process.env["COSMOSDB_KEY"];
const databaseId = process.env["IAData"];
const containerId = process.env["tickets"];

const client = new CosmosClient({ endpoint, key });

const getContainer = () => {
  const db = client.database(databaseId);
  return db.container(containerId);
};

module.exports = { getContainer };
