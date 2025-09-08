# Scalar API Documentation Integration Plan

## Análisis del Proyecto Actual

### Estructura Actual
- **Framework**: Azure Functions v4
- **Runtime**: Node.js
- **Arquitectura**: Serverless con múltiples endpoints HTTP
- **OpenAPI**: Ya disponible en `openapi.yaml`
- **Deployment**: Azure Functions (presumiblemente)

## Opciones de Integración de Scalar

### Opción 1: Endpoint Dedicado en Azure Functions ⭐ **RECOMENDADA**

**Ventajas:**
- Se integra nativamente con la arquitectura existente
- Mismo dominio y autenticación
- Fácil mantenimiento y despliegue
- Acceso a variables de entorno de Azure

**Pasos de Implementación:**

#### 1. Instalar Dependencias
```bash
npm install @scalar/api-reference express
npm install --save-dev @types/express
```

#### 2. Crear Endpoint de Documentación
```javascript
// src/functions/apiDocs.js
const { app } = require('@azure/functions');
const fs = require('fs');
const path = require('path');

app.http('apiDocs', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'docs',
  handler: async (request, context) => {
    try {
      // Leer el archivo OpenAPI
      const openApiPath = path.join(__dirname, '../../openapi.yaml');
      const openApiSpec = fs.readFileSync(openApiPath, 'utf8');
      
      const html = `
<!DOCTYPE html>
<html>
<head>
  <title>VAPI to Cosmos DB API Documentation</title>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    body { margin: 0; padding: 0; }
  </style>
</head>
<body>
  <script
    id="api-reference"
    data-url="data:application/yaml;base64,${Buffer.from(openApiSpec).toString('base64')}"
    data-configuration='${JSON.stringify({
      theme: 'purple',
      layout: 'modern',
      showSidebar: true,
      hideDownloadButton: false,
      searchHotKey: 'k',
      darkMode: false,
      customCss: `
        .scalar-app {
          --scalar-color-1: #2D1B69;
          --scalar-color-2: #9C27B0;
          --scalar-color-accent: #673AB7;
        }
      `
    })}'></script>
  <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
</body>
</html>`;

      return {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'public, max-age=3600'
        },
        body: html
      };
    } catch (error) {
      context.log('Error serving API docs:', error);
      return {
        status: 500,
        headers: { 'Content-Type': 'text/plain' },
        body: 'Error loading API documentation'
      };
    }
  }
});
```

#### 3. Endpoint para OpenAPI JSON
```javascript
// src/functions/openapi.js
const { app } = require('@azure/functions');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

app.http('openapi', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'openapi.json',
  handler: async (request, context) => {
    try {
      const openApiPath = path.join(__dirname, '../../openapi.yaml');
      const openApiYaml = fs.readFileSync(openApiPath, 'utf8');
      const openApiJson = yaml.load(openApiYaml);
      
      // Actualizar URLs dinámicamente
      const baseUrl = `https://${request.headers.get('host')}`;
      openApiJson.servers = [
        { url: `${baseUrl}/api`, description: 'Current Environment' },
        ...openApiJson.servers
      ];

      return {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=300'
        },
        body: JSON.stringify(openApiJson, null, 2)
      };
    } catch (error) {
      context.log('Error serving OpenAPI spec:', error);
      return {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Error loading OpenAPI specification' })
      };
    }
  }
});
```

### Opción 2: Static Web App Separada

**Ventajas:**
- Mejor rendimiento (contenido estático)
- CDN automático
- Separación de responsabilidades

**Implementación:**
```javascript
// docs/index.html
<!DOCTYPE html>
<html>
<head>
  <title>VAPI API Documentation</title>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
</head>
<body>
  <script
    id="api-reference"
    data-url="https://your-function-app.azurewebsites.net/api/openapi.json"
    data-configuration='{
      "theme": "purple",
      "layout": "modern",
      "showSidebar": true
    }'></script>
  <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
</body>
</html>
```

### Opción 3: Integración con Existing Frontend

Si existe una aplicación frontend, integrar directamente:

```javascript
// En tu aplicación React/Vue/Angular
import { ApiReferenceReact } from '@scalar/api-reference-react'

function ApiDocs() {
  return (
    <ApiReferenceReact
      configuration={{
        spec: {
          url: '/api/openapi.json',
        },
        theme: 'purple',
        layout: 'modern',
      }}
    />
  )
}
```

## Plan de Implementación Detallado

### Fase 1: Configuración Básica (1-2 días)

#### Paso 1: Actualizar package.json
```json
{
  "dependencies": {
    "@scalar/api-reference": "^1.24.0",
    "js-yaml": "^4.1.0"
  },
  "scripts": {
    "docs:serve": "func start",
    "docs:build": "echo 'Documentation built with Azure Functions'",
    "openapi:validate": "swagger-codegen validate -i openapi.yaml"
  }
}
```

#### Paso 2: Crear Función de Documentación
```javascript
// src/functions/docs/index.js
const { app } = require('@azure/functions');
const fs = require('fs');
const path = require('path');

app.http('docs', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'docs/{*path}',
  handler: async (request, context) => {
    const pathParam = request.params.path || '';
    
    // Manejar diferentes rutas
    switch (pathParam) {
      case '':
      case 'index.html':
        return serveDocumentation(request, context);
      case 'openapi.json':
        return serveOpenApiSpec(request, context);
      default:
        return { status: 404, body: 'Not Found' };
    }
  }
});

function serveDocumentation(request, context) {
  const baseUrl = `https://${request.headers.get('host')}/api`;
  
  const html = `
<!DOCTYPE html>
<html>
<head>
  <title>VAPI to Cosmos DB API</title>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <link rel="icon" type="image/png" href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" />
</head>
<body>
  <script
    id="api-reference"
    data-url="${baseUrl}/docs/openapi.json"
    data-configuration='${JSON.stringify({
      theme: 'purple',
      layout: 'modern',
      showSidebar: true,
      hideDownloadButton: false,
      searchHotKey: 'k',
      customCss: `
        .scalar-app {
          --scalar-color-1: #2D1B69;
          --scalar-color-2: #673AB7;
          --scalar-color-accent: #9C27B0;
          --scalar-border-radius: 8px;
        }
        .scalar-card {
          box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        }
      `,
      metadata: {
        title: 'VAPI to Cosmos DB API',
        description: 'Complete API documentation for ticket management and call handling system',
        ogDescription: 'Explore and test our REST API endpoints for managing support tickets and call analytics.',
      },
      hideModels: false,
      hideDownloadButton: false,
      authentication: {
        preferredSecurityScheme: 'bearerAuth',
        apiKey: {
          token: 'your-api-key-here'
        }
      }
    })}'></script>
  <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference@latest/dist/browser/standalone.js"></script>
</body>
</html>`;

  return {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff'
    },
    body: html
  };
}
```

### Fase 2: Mejoras Avanzadas (2-3 días)

#### Autenticación Inteligente
```javascript
// Detectar si el usuario está autenticado
function getAuthenticationConfig(request) {
  const authHeader = request.headers.get('authorization');
  const hasToken = authHeader && authHeader.startsWith('Bearer ');
  
  return {
    preferredSecurityScheme: 'bearerAuth',
    ...(hasToken && {
      http: {
        bearer: {
          token: authHeader.replace('Bearer ', '')
        }
      }
    })
  };
}
```

#### Versionado Automático
```javascript
// Leer versión del package.json
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8'));

// Actualizar OpenAPI spec dinámicamente
openApiSpec.info.version = packageJson.version;
openApiSpec.info.description = `${openApiSpec.info.description}\n\nBuild: ${process.env.BUILD_NUMBER || 'dev'}`;
```

#### Temas Personalizados
```css
/* Custom theme para empresa */
.scalar-app {
  --scalar-color-1: #1a365d;        /* Azul oscuro */
  --scalar-color-2: #2d3748;        /* Gris oscuro */
  --scalar-color-3: #4a5568;        /* Gris medio */
  --scalar-color-accent: #3182ce;   /* Azul principal */
  --scalar-background-1: #ffffff;   /* Fondo blanco */
  --scalar-background-2: #f7fafc;   /* Fondo gris claro */
  --scalar-background-3: #edf2f7;   /* Fondo gris */
  --scalar-border-color: #e2e8f0;   /* Bordes */
  --scalar-font-size: 14px;
  --scalar-border-radius: 6px;
  --scalar-font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}
```

### Fase 3: Optimización y Deploy (1 día)

#### CI/CD Integration
```yaml
# .github/workflows/deploy-docs.yml
name: Deploy API Documentation

on:
  push:
    branches: [ main ]
    paths: [ 'openapi.yaml', 'src/functions/docs/**' ]

jobs:
  deploy-docs:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Validate OpenAPI
        run: |
          npx swagger-codegen validate -i openapi.yaml
          
      - name: Deploy to Azure Functions
        uses: Azure/functions-action@v1
        with:
          app-name: your-function-app
          slot-name: 'production'
          package: .
          publish-profile: ${{ secrets.AZURE_FUNCTIONAPP_PUBLISH_PROFILE }}
```

### Configuración Avanzada

#### Configuración Completa de Scalar
```javascript
const scalarConfig = {
  // Apariencia
  theme: 'purple',          // 'default' | 'alternate' | 'purple' | 'solarized'
  layout: 'modern',         // 'modern' | 'classic'
  darkMode: false,          // true | false | 'system'
  
  // Funcionalidades
  showSidebar: true,
  hideDownloadButton: false,
  hideTestRequestButton: false,
  hideModels: false,
  hiddenClients: [],
  
  // Navegación
  searchHotKey: 'k',
  
  // Personalización
  customCss: `
    .scalar-app { --scalar-radius-lg: 8px; }
    .method-get { --scalar-method-color: #10b981; }
    .method-post { --scalar-method-color: #3b82f6; }
    .method-patch { --scalar-method-color: #f59e0b; }
    .method-delete { --scalar-method-color: #ef4444; }
  `,
  
  // Metadata
  metadata: {
    title: 'VAPI API Documentation',
    description: 'Complete REST API for ticket management',
    ogTitle: 'VAPI API Docs',
    ogDescription: 'Explore and test our REST API',
    ogImage: 'https://your-domain.com/api-og-image.png',
    twitterCard: 'summary_large_image'
  },
  
  // Autenticación
  authentication: {
    preferredSecurityScheme: 'bearerAuth',
    apiKey: {
      token: ''  // Se llena dinámicamente
    }
  },
  
  // Proxy para CORS en desarrollo
  proxy: process.env.NODE_ENV === 'development' ? 'https://proxy.cors.sh' : undefined,
  
  // Configuración de peticiones
  withCredentials: true,
  
  // Ocultar elementos específicos
  hiddenClients: ['shell', 'python'],  // Solo mostrar JavaScript, cURL, etc.
  
  // Configuración de servidor por defecto
  defaultOpenAllTags: false,
  tagsSorter: 'alpha',
  operationsSorter: 'alpha'
};
```

## Ventajas de Usar Scalar vs Alternativas

### Vs Swagger UI
- ✅ Mejor rendimiento y UX moderna
- ✅ Temas más atractivos
- ✅ Mejor responsividad móvil
- ✅ Configuración más sencilla

### Vs Redoc
- ✅ Interfaz más interactiva
- ✅ Mejor para pruebas de API
- ✅ Más opciones de personalización
- ❌ Menos maduro en el ecosistema

### Vs Postman Docs
- ✅ Integración nativa con OpenAPI
- ✅ Sin dependencias externas
- ✅ Control completo sobre hosting
- ❌ Menos colaboración built-in

## Consideraciones de Seguridad

### Protección de la Documentación
```javascript
// Middleware de autenticación opcional para docs
const { withAuth } = require('../auth/withAuth');

// Documentación protegida para APIs internas
app.http('docsPrivate', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'docs/private',
  handler: withAuth(serveDocumentation, {
    scopesAny: ['api.read'],
    groupsAny: ['developers', 'admins']
  })
});

// Documentación pública para APIs públicas
app.http('docsPublic', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'docs/public',
  handler: servePublicDocumentation
});
```

### Variables Sensibles
```javascript
// Filtrar información sensible del OpenAPI spec
function sanitizeOpenApiSpec(spec, isPublic = false) {
  const cleanSpec = JSON.parse(JSON.stringify(spec));
  
  if (isPublic) {
    // Remover endpoints internos
    Object.keys(cleanSpec.paths).forEach(path => {
      if (path.includes('/internal/') || path.includes('/admin/')) {
        delete cleanSpec.paths[path];
      }
    });
    
    // Remover esquemas internos
    delete cleanSpec.components.schemas.InternalUser;
    delete cleanSpec.components.schemas.AdminStats;
  }
  
  return cleanSpec;
}
```

## Estimación de Tiempo y Recursos

### Tiempo de Implementación
- **Configuración básica**: 4-6 horas
- **Personalización avanzada**: 8-12 horas
- **Testing y optimización**: 4-8 horas
- **Documentación y training**: 2-4 horas

**Total**: 2-3 días de desarrollo

### Recursos Necesarios
- **Desarrollador**: 1 persona con conocimiento de Azure Functions
- **Diseñador** (opcional): Para personalización visual avanzada
- **DevOps**: Para configuración de CI/CD

### Costos Operacionales
- **Azure Functions**: ~$0-5/mes (muy bajo tráfico esperado)
- **CDN** (si se usa): ~$1-10/mes
- **Dominio personalizado** (opcional): ~$10-15/año

## Próximos Pasos Recomendados

### Inmediatos (Esta semana)
1. ✅ Instalar dependencias de Scalar
2. ✅ Crear endpoint básico de documentación
3. ✅ Probar localmente con `func start`
4. ✅ Validar OpenAPI spec

### Corto plazo (Próximas 2 semanas)
1. 🔄 Personalizar tema corporativo
2. 🔄 Configurar autenticación inteligente
3. 🔄 Implementar versionado automático
4. 🔄 Deploy a staging environment

### Mediano plazo (Próximo mes)
1. ⏳ Configurar CI/CD para docs
2. ⏳ Crear documentación para desarrolladores
3. ⏳ Implementar analytics de uso
4. ⏳ Training al equipo

## Comandos Útiles

```bash
# Instalar dependencias
npm install @scalar/api-reference js-yaml

# Validar OpenAPI
npx swagger-codegen validate -i openapi.yaml

# Servir localmente
func start --port 7071

# Test endpoints
curl http://localhost:7071/api/docs
curl http://localhost:7071/api/docs/openapi.json

# Deploy
func azure functionapp publish <function-app-name>
```

## Conclusión

La integración de Scalar es **altamente recomendada** para este proyecto porque:

1. **Compatibilidad perfecta** con Azure Functions
2. **Aprovecha el OpenAPI existente** sin modificaciones
3. **UX moderna** que mejorará la adopción de la API
4. **Bajo costo** de implementación y mantenimiento
5. **Escalable** para futuras necesidades

La **Opción 1 (Endpoint dedicado)** es la más práctica para empezar, con posibilidad de migrar a Static Web App más adelante si el tráfico lo justifica.