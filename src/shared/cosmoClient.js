const { CosmosClient } = require("@azure/cosmos");
const { DefaultAzureCredential } = require("@azure/identity");

const endpoint = process.env.COSMOS_ENDPOINT;
const credential = new DefaultAzureCredential();

const client = new CosmosClient({
  endpoint,
  aadCredentials: credential
});

const getContainer = () => {
  const db = client.database(process.env.COSMOS_DATABASE_ID);
  return db.container(process.env.COSMOS_CONTAINER_ID);
};

module.exports = { getContainer };
