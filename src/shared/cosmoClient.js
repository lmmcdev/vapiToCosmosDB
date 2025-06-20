/*const { CosmosClient } = require("@azure/cosmos");

const endpoint = process.env.COSMOS_ENDPOINT;
const key = process.env.COSMOS_KEY;
const databaseId = process.env.COSMOS_DATABASE_ID;
const containerId = process.env.COSMOS_CONTAINER_ID;

const client = new CosmosClient({ endpoint, key });

const getContainer = () => {
  const database = client.database(databaseId);
  return database.container(containerId);
};

module.exports = { getContainer };*/


//LOCALHOST
const { CosmosClient } = require("@azure/cosmos");

const endpoint = "https://lmmccosmos02.documents.azure.com:443/";
const key = "bqkSDoT1ZqeTDE6lW0GsNvvPg8B9SvgVwSF78OOGGDYWdsQOMwP486LWFjm0aN0mXqO06fbQLYH9ACDbVhcWJA=="; // la clave primaria

const client = new CosmosClient({
  endpoint,
  key
});

const getContainer = () => {
  const db = client.database("IAData");
  return db.container("iadata_id");
};
module.exports = { getContainer };