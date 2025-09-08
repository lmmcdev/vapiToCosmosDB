# Contract Testing Proposal

## Overview
This document proposes contract testing implementation for the VAPI to Cosmos DB API to ensure API compatibility and prevent breaking changes.

## Testing Strategy

### 1. Provider Tests (API Server)
Test that the API provides the expected contract specified in `openapi.yaml`.

### 2. Consumer Tests (Client Applications)
Test that client applications can consume the API according to the contract.

### 3. Schema Validation Tests
Validate request/response payloads against OpenAPI schemas.

## Proposed Testing Framework: Pact

### Setup
```bash
npm install --save-dev @pact-foundation/pact @pact-foundation/pact-cli-ruby
```

### Example Contract Tests

#### Provider Test Example (API Server)
```javascript
// tests/contract/provider.test.js
const { Verifier } = require('@pact-foundation/pact');
const path = require('path');

describe('VAPI API Contract Tests', () => {
  let server;

  before(async () => {
    // Start your API server
    server = await startApiServer();
  });

  after(async () => {
    // Stop your API server
    await server.close();
  });

  it('should satisfy all consumer contracts', async () => {
    const opts = {
      provider: 'VAPI-API',
      providerBaseUrl: 'http://localhost:7071/api',
      pactUrls: [
        path.resolve(process.cwd(), 'pacts/frontend-vapi-api.json'),
        path.resolve(process.cwd(), 'pacts/mobile-vapi-api.json')
      ],
      publishVerificationResult: true,
      providerVersion: process.env.GIT_COMMIT || '1.0.0',
    };

    await new Verifier(opts).verifyProvider();
  });
});
```

#### Consumer Test Example (Frontend Client)
```javascript
// tests/contract/consumer.test.js
const { Pact } = require('@pact-foundation/pact');
const { like, term } = require('@pact-foundation/pact/dsl/matchers');
const axios = require('axios');

const provider = new Pact({
  consumer: 'Frontend',
  provider: 'VAPI-API',
  port: 1234,
  log: path.resolve(process.cwd(), 'logs', 'pact.log'),
  dir: path.resolve(process.cwd(), 'pacts'),
  logLevel: 'INFO',
});

describe('VAPI API Consumer Contract', () => {
  before(() => provider.setup());
  after(() => provider.finalize());

  describe('POST /cosmoInsertVapi', () => {
    beforeEach(() => {
      const ticketInteraction = {
        state: 'ticket creation is enabled',
        uponReceiving: 'a request to create a new ticket',
        withRequest: {
          method: 'POST',
          path: '/api/cosmoInsertVapi',
          headers: {
            'Content-Type': 'application/json',
          },
          body: {
            summary: like('Customer needs help with billing'),
            phone_number: term({
              generate: '+1234567890',
              matcher: '^[\\+]?[\\d\\s\\-\\(\\)]{7,20}$'
            }),
            call_reason: like('Billing inquiry'),
            patient_name: like('John Doe'),
            assigned_department: term({
              generate: 'billing',
              matcher: '^(switchboard|medical|billing|enrollment|pharmacy|transportation|quality|admin)$'
            })
          },
        },
        willRespondWith: {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
          body: {
            success: true,
            message: like('Ticket created successfully'),
            tickets: term({
              generate: '550e8400-e29b-41d4-a716-446655440000',
              matcher: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            }),
            id: term({
              generate: '550e8400-e29b-41d4-a716-446655440000',
              matcher: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            }),
            summary: like('Customer needs help with billing'),
            status: 'New'
          },
        },
      };

      return provider.addInteraction(ticketInteraction);
    });

    it('should create a new ticket', async () => {
      const response = await axios.post(
        'http://localhost:1234/api/cosmoInsertVapi',
        {
          summary: 'Customer needs help with billing',
          phone_number: '+1234567890',
          call_reason: 'Billing inquiry',
          patient_name: 'John Doe',
          assigned_department: 'billing'
        },
        {
          headers: { 'Content-Type': 'application/json' }
        }
      );

      expect(response.status).to.equal(200);
      expect(response.data.success).to.be.true;
      expect(response.data.tickets).to.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });
  });

  describe('GET /cosmoGet', () => {
    beforeEach(() => {
      const getTicketsInteraction = {
        state: 'tickets exist for user',
        uponReceiving: 'a request to get user tickets',
        withRequest: {
          method: 'GET',
          path: '/api/cosmoGet',
          headers: {
            'Authorization': term({
              generate: 'Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9...',
              matcher: '^Bearer [A-Za-z0-9\\-_=]+\\.[A-Za-z0-9\\-_=]+\\.?[A-Za-z0-9\\-_.+/=]*$'
            }),
          },
        },
        willRespondWith: {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
          body: {
            success: true,
            message: like('Tickets retrieved'),
            data: like([
              {
                id: term({
                  generate: '550e8400-e29b-41d4-a716-446655440000',
                  matcher: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                }),
                summary: like('Test ticket'),
                status: like('New'),
                assigned_department: like('switchboard')
              }
            ])
          },
        },
      };

      return provider.addInteraction(getTicketsInteraction);
    });

    it('should retrieve user tickets with valid JWT', async () => {
      const response = await axios.get(
        'http://localhost:1234/api/cosmoGet',
        {
          headers: {
            'Authorization': 'Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9...'
          }
        }
      );

      expect(response.status).to.equal(200);
      expect(response.data.success).to.be.true;
      expect(response.data.data).to.be.an('array');
    });
  });
});
```

#### Schema Validation Tests
```javascript
// tests/schema-validation.test.js
const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const fs = require('fs');
const yaml = require('js-yaml');

describe('OpenAPI Schema Validation', () => {
  let ajv;
  let schemas;

  before(() => {
    ajv = new Ajv({ allErrors: true });
    addFormats(ajv);
    
    // Load OpenAPI spec
    const openApiSpec = yaml.load(fs.readFileSync('./openapi.yaml', 'utf8'));
    schemas = openApiSpec.components.schemas;
    
    // Add schemas to AJV
    Object.keys(schemas).forEach(schemaName => {
      ajv.addSchema(schemas[schemaName], schemaName);
    });
  });

  describe('Request Validation', () => {
    it('should validate CreateTicketRequest schema', () => {
      const validRequest = {
        summary: 'Test ticket summary',
        phone_number: '+1234567890',
        call_reason: 'Technical support',
        assigned_department: 'technical'
      };

      const validate = ajv.getSchema('CreateTicketRequest');
      const isValid = validate(validRequest);
      
      if (!isValid) {
        console.log('Validation errors:', validate.errors);
      }
      
      expect(isValid).to.be.true;
    });

    it('should reject invalid CreateTicketRequest', () => {
      const invalidRequest = {
        summary: '', // Too short
        phone_number: 'invalid-phone', // Invalid format
        call_cost: -5 // Negative value
      };

      const validate = ajv.getSchema('CreateTicketRequest');
      const isValid = validate(invalidRequest);
      
      expect(isValid).to.be.false;
      expect(validate.errors).to.have.length.greaterThan(0);
    });
  });

  describe('Response Validation', () => {
    it('should validate Ticket schema', () => {
      const validTicket = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        summary: 'Test ticket',
        status: 'New',
        notes: [],
        collaborators: []
      };

      const validate = ajv.getSchema('Ticket');
      const isValid = validate(validTicket);
      
      if (!isValid) {
        console.log('Validation errors:', validate.errors);
      }
      
      expect(isValid).to.be.true;
    });
  });
});
```

## CI/CD Integration

### GitHub Actions Example
```yaml
# .github/workflows/contract-tests.yml
name: Contract Tests

on:
  push:
    branches: [ main, develop ]
  pull_request:
    branches: [ main ]

jobs:
  contract-tests:
    runs-on: ubuntu-latest
    
    steps:
    - uses: actions/checkout@v3
    
    - name: Setup Node.js
      uses: actions/setup-node@v3
      with:
        node-version: '18'
        
    - name: Install dependencies
      run: npm install
      
    - name: Run Provider Contract Tests
      run: npm run test:contract:provider
      
    - name: Run Consumer Contract Tests
      run: npm run test:contract:consumer
      
    - name: Run Schema Validation Tests
      run: npm run test:schema
      
    - name: Publish Pact Results
      if: success()
      run: npm run pact:publish
      env:
        PACT_BROKER_BASE_URL: ${{ secrets.PACT_BROKER_URL }}
        PACT_BROKER_TOKEN: ${{ secrets.PACT_BROKER_TOKEN }}
```

### Package.json Scripts
```json
{
  "scripts": {
    "test:contract": "npm run test:contract:consumer && npm run test:contract:provider",
    "test:contract:consumer": "mocha tests/contract/consumer.test.js --timeout 30000",
    "test:contract:provider": "mocha tests/contract/provider.test.js --timeout 30000",
    "test:schema": "mocha tests/schema-validation.test.js",
    "pact:publish": "pact-broker publish pacts --consumer-app-version=$GIT_COMMIT --tag=$GIT_BRANCH"
  }
}
```

## Benefits

1. **Breaking Change Detection**: Automatically detect when API changes break existing consumers
2. **Documentation**: Living documentation that stays in sync with implementation
3. **Confidence**: Deploy with confidence knowing contracts are satisfied
4. **Team Coordination**: Better coordination between API providers and consumers
5. **Regression Prevention**: Prevent regression bugs in API compatibility

## Implementation Phases

### Phase 1: Basic Setup (Week 1)
- [ ] Set up Pact testing framework
- [ ] Create basic consumer tests for critical endpoints
- [ ] Set up provider verification

### Phase 2: Comprehensive Coverage (Week 2-3)
- [ ] Add contract tests for all major endpoints
- [ ] Implement schema validation tests
- [ ] Set up CI/CD integration

### Phase 3: Advanced Features (Week 4)
- [ ] Set up Pact Broker for contract sharing
- [ ] Add performance contract testing
- [ ] Implement contract-driven development workflow

## Tools and Libraries

### Required Dependencies
```json
{
  "devDependencies": {
    "@pact-foundation/pact": "^10.4.1",
    "@pact-foundation/pact-cli-ruby": "^13.13.13",
    "ajv": "^8.12.0",
    "ajv-formats": "^2.1.1",
    "js-yaml": "^4.1.0",
    "mocha": "^10.2.0",
    "chai": "^4.3.7",
    "axios": "^1.4.0"
  }
}
```

### Recommended Tools
- **Pact Broker**: For sharing and managing contracts
- **Postman/Newman**: For additional API testing
- **OpenAPI Generator**: For generating client SDKs
- **Spectral**: For OpenAPI linting

## Next Steps

1. Review and approve this proposal
2. Set up development environment with required tools
3. Begin with Phase 1 implementation
4. Establish testing protocols and CI/CD integration
5. Train team members on contract testing practices

## TODO Items

- [ ] Set up Pact Broker instance or use hosted service
- [ ] Define consumer applications that need contract testing
- [ ] Create test data fixtures for consistent testing
- [ ] Set up monitoring for contract test failures
- [ ] Document contract testing workflow for the team
- [ ] Add performance contract testing for critical endpoints
- [ ] Implement contract versioning strategy
- [ ] Set up automated contract documentation generation