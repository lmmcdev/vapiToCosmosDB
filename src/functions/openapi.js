const { app } = require('@azure/functions');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

app.http('openapi', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'docs/openapi.json',
  handler: async (request, context) => {
    try {
      // Leer y parsear el archivo OpenAPI YAML
      const openApiPath = path.join(__dirname, '../../openapi.yaml');
      
      if (!fs.existsSync(openApiPath)) {
        context.log('❌ OpenAPI file not found at:', openApiPath);
        return {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            error: 'OpenAPI specification file not found',
            path: openApiPath 
          })
        };
      }

      const openApiYaml = fs.readFileSync(openApiPath, 'utf8');
      const openApiJson = yaml.load(openApiYaml);
      
      // Actualizar URLs del servidor dinámicamente
      const host = request.headers.get('host') || 'localhost:7071';
      const protocol = request.headers.get('x-forwarded-proto') || 'http';
      const baseUrl = `${protocol}://${host}/api`;
      
      // Actualizar servers en el spec
      openApiJson.servers = [
        { 
          url: baseUrl, 
          description: 'Current Environment' 
        },
        ...(openApiJson.servers || [])
      ];

      // Leer versión del package.json si existe
      try {
        const packagePath = path.join(__dirname, '../../package.json');
        const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
        openApiJson.info.version = packageJson.version || openApiJson.info.version;
      } catch (e) {
        context.log('⚠️  Could not read package.json for version');
      }

      // Agregar metadata adicional
      const buildInfo = {
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development',
        host: host
      };

      if (!openApiJson.info['x-build-info']) {
        openApiJson.info['x-build-info'] = buildInfo;
      }

      context.log(`📋 Serving OpenAPI spec for: ${baseUrl}`);

      return {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Cache-Control': 'public, max-age=300', // 5 minutos de cache
          'ETag': `"${Date.now()}"` // ETag simple basado en timestamp
        },
        body: JSON.stringify(openApiJson, null, 2)
      };

    } catch (error) {
      context.log('❌ Error serving OpenAPI spec:', error);
      
      return {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'Error loading OpenAPI specification',
          message: error.message,
          timestamp: new Date().toISOString()
        }, null, 2)
      };
    }
  }
});

// Endpoint adicional para servir el YAML raw
app.http('openapiYaml', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'docs/openapi.yaml',
  handler: async (request, context) => {
    try {
      const openApiPath = path.join(__dirname, '../../openapi.yaml');
      
      if (!fs.existsSync(openApiPath)) {
        return {
          status: 404,
          headers: { 'Content-Type': 'text/plain' },
          body: 'OpenAPI YAML file not found'
        };
      }

      const openApiYaml = fs.readFileSync(openApiPath, 'utf8');
      
      context.log('📄 Serving OpenAPI YAML file');

      return {
        status: 200,
        headers: {
          'Content-Type': 'application/x-yaml; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=300',
          'Content-Disposition': 'inline; filename="openapi.yaml"'
        },
        body: openApiYaml
      };

    } catch (error) {
      context.log('❌ Error serving OpenAPI YAML:', error);
      
      return {
        status: 500,
        headers: { 'Content-Type': 'text/plain' },
        body: `Error loading OpenAPI YAML: ${error.message}`
      };
    }
  }
});