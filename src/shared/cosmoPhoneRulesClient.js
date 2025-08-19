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
