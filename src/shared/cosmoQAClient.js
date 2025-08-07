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


//LOCALHOST
/*const { CosmosClient } = require("@azure/cosmos");

const endpoint = "https://lmmccosmos02.documents.azure.com:443/";
const key = ""; // la clave primaria

const client = new CosmosClient({
  endpoint,
  key
});

const getPatientsContainer = () => {
  const db = client.database("IAData");
  return db.container("patients_id");
};
module.exports = { getPatientsContainer };*/