const { app } = require('@azure/functions');
const fs = require('fs');
const path = require('path');

app.http('apiDocs', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'docs',
  handler: async (request, context) => {
    try {
      // Determinar la URL base del servidor actual
      const host = request.headers.get('host') || 'localhost:7071';
      const protocol = request.headers.get('x-forwarded-proto') || 'http';
      const baseUrl = `${protocol}://${host}/api`;
      
      context.log(`📚 Serving API documentation for: ${baseUrl}`);

      // Leer el archivo OpenAPI YAML
      const openApiPath = path.join(__dirname, '../../openapi.yaml');
      
      if (!fs.existsSync(openApiPath)) {
        context.log('❌ OpenAPI file not found at:', openApiPath);
        return {
          status: 404,
          headers: { 'Content-Type': 'text/plain' },
          body: 'OpenAPI specification file not found'
        };
      }

      const openApiSpec = fs.readFileSync(openApiPath, 'utf8');
      
      // Configuración simplificada sin caracteres problemáticos
      const config = {
        theme: 'purple',
        layout: 'modern',
        showSidebar: true,
        hideDownloadButton: false,
        searchHotKey: 'k',
        darkMode: false,
        metadata: {
          title: 'VAPI to Cosmos DB API Documentation',
          description: 'Complete API documentation for ticket management and call handling system'
        }
      };

      // Convertir config a JSON sin problemas de escape
      const configJson = JSON.stringify(config).replace(/"/g, '&quot;');
      const specUrl = `${baseUrl}/docs/openapi.json`;

      // HTML más simple y confiable
      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>VAPI API Documentation</title>
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='90'%3E📚%3C/text%3E%3C/svg%3E" />
  <style>
    body { 
      margin: 0; 
      padding: 0; 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    .loading {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100vh;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      font-size: 18px;
    }
    .loading .spinner {
      width: 40px;
      height: 40px;
      border: 4px solid rgba(255,255,255,0.3);
      border-radius: 50%;
      border-top-color: #fff;
      animation: spin 1s ease-in-out infinite;
      margin-bottom: 20px;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    /* Scalar custom styles */
    .scalar-app {
      --scalar-color-1: #2D1B69 !important;
      --scalar-color-2: #673AB7 !important;
      --scalar-color-accent: #9C27B0 !important;
      --scalar-border-radius: 8px !important;
    }
  </style>
</head>
<body>
  <div id="loading" class="loading">
    <div class="spinner"></div>
    <div>Loading API Documentation...</div>
  </div>

  <script
    id="api-reference"
    data-url="${specUrl}"
    data-configuration="${configJson}"
  ></script>

  <script>
    // Remove loading indicator after a short delay
    setTimeout(() => {
      const loading = document.getElementById('loading');
      if (loading) loading.style.display = 'none';
    }, 2000);

    // Error fallback
    setTimeout(() => {
      const loading = document.getElementById('loading');
      if (loading && loading.style.display !== 'none') {
        loading.innerHTML = '<div style="text-align: center;"><h3>⚠️ Loading taking longer than expected</h3><p>The documentation should appear shortly...</p><p><a href="${specUrl}" target="_blank" style="color: white;">View Raw OpenAPI Spec</a></p></div>';
      }
    }, 5000);
  </script>
  
  <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.24.66/dist/browser/standalone.js"></script>
</body>
</html>`;

      return {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'public, max-age=3600',
          'X-Content-Type-Options': 'nosniff',
          'X-Frame-Options': 'SAMEORIGIN'
        },
        body: html
      };

    } catch (error) {
      context.log('❌ Error serving API documentation:', error);
      return {
        status: 500,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
        body: `
<!DOCTYPE html>
<html>
<head>
  <title>API Documentation Error</title>
  <style>
    body { font-family: Arial, sans-serif; padding: 40px; background: #f8f9fa; text-align: center; }
    .error { background: #dc3545; color: white; padding: 20px; border-radius: 8px; margin: 20px 0; }
    .fallback { background: #007bff; color: white; padding: 15px; border-radius: 8px; margin: 20px 0; }
    a { color: white; text-decoration: underline; }
  </style>
</head>
<body>
  <div class="error">
    <h2>❌ Error Loading Documentation</h2>
    <p><strong>Error:</strong> ${error.message}</p>
  </div>
  <div class="fallback">
    <h3>📋 Alternative Options</h3>
    <p><a href="/api/docs/openapi.json">View OpenAPI JSON Specification</a></p>
    <p><a href="/api/docs/openapi.yaml">View OpenAPI YAML Specification</a></p>
  </div>
</body>
</html>`
      };
    }
  }
});