const { CosmosClient } = require("@azure/cosmos");

const endpoint = process.env.COSMOS_ENDPOINT;
const key = process.env.COSMOS_KEY;
const databaseId = process.env.COSMOS_DATABASE_ID;
const containerId = 'phone_link_rules';

const client = new CosmosClient({ endpoint, key });

const getPhoneRulesContainer = () => {
  const database = client.database(databaseId);
  return database.container(containerId);
};

module.exports = { getPhoneRulesContainer };


//LOCALHOST
/*const { CosmosClient } = require("@azure/cosmos");

const endpoint = "https://lmmccosmos02.documents.azure.com:443/";
const key = "bqkSDoT1ZqeTDE6lW0GsNvvPg8B9SvgVwSF78OOGGDYWdsQOMwP486LWFjm0aN0mXqO06fbQLYH9ACDbVhcWJA=="; // la clave primaria

const client = new CosmosClient({
  endpoint,
  key
});

const getPhoneRulesContainer = () => {
  const db = client.database("IAData");
  return db.container("phone_link_rules");
};
module.exports = { getPhoneRulesContainer };*/