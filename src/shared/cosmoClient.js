const { CosmosClient } = require("@azure/cosmos");

const endpoint = process.env.COSMOS_ENDPOINT;
const key = process.env.COSMOS_KEY;
const databaseId = process.env.COSMOS_DATABASE_ID;
const containerId = process.env.COSMOS_CONTAINER_ID;

const client = new CosmosClient({ endpoint, key });

const getContainer = () => {
  const database = client.database(databaseId);
  return database.container(containerId);
};

module.exports = { getContainer };


//LOCALHOST
/*const { CosmosClient } = require("@azure/cosmos");

const endpoint = "https://lmmccosmos02.documents.azure.com:443/";
const key = ""; // la clave primaria

const client = new CosmosClient({
  endpoint,
  key
});

const getContainer = () => {
  const db = client.database("IAData");
  return db.container("iadata_id");
};
module.exports = { getContainer };*/



/*const { CosmosClient } = require("@azure/cosmos");
const { DefaultAzureCredential } = require("@azure/identity");

const endpoint = process.env.COSMOS_ENDPOINT; // debe ser igual al sqlEndpoint
const credential = new DefaultAzureCredential(); // tomará la identidad asignada

const client = new CosmosClient({
  endpoint,
  aadCredentials: credential
});

const getContainer = () => {
  const db = client.database(process.env.COSMOS_DATABASE_ID);
  return db.container(process.env.COSMOS_CONTAINER_ID);
};

module.exports = { getContainer };*/

