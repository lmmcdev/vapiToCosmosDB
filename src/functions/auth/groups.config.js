// functions/auth/groups.config.js (CommonJS)

// Define aquí los grupos autorizados por módulo.
// Agrega más módulos según necesites.
const GROUPS = {
  REFERRALS: {
    ACCESS_GROUP:      'bb7d859f-7032-405c-9dee-73cde7a6fb32', // puerta de entrada al módulo
    SUPERVISORS_GROUP: '4103988e-0a39-4a6c-aa39-e0c1fad5cf92',
    AGENTS_GROUP:      '84a3609f-65c5-4353-b0a8-530e7f229072',
    REMOTEAGENTS_GROUP: 'b5adb985-0d20-4078-916d-126b07fafed2',
  },

  SWITCHBOARD: {
    ACCESS_GROUP:      'bb7d859f-7032-405c-9dee-73cde7a6fb31', // puerta de entrada al módulo
    SUPERVISORS_GROUP: '4103988e-0a39-4a6c-aa39-e0c1fad5cf95', //ALL SUPERVISORS GROUPS MUST TO GO WITH THIS NAME
    AGENTS_GROUP:      '84a3609f-65c5-4353-b0a8-530e7f22907e',
    REMOTEAGENTS_GROUP: 'b5adb985-0d20-4078-916d-126b07fafeda',
  },

  QUALITY: {
    QUALITY_GROUP: '1d48ef41-8e80-46ed-8ff3-3b084dedfb7f'
  }

  // Ejemplo (si lo necesitas luego):
  // CUSTOMER_SERVICE: {
  //   ACCESS_GROUP:      'bb7d859f-7032-405c-9dee-73cde7a6fb42',
  //   SUPERVISORS_GROUP: 'bb7d859f-7032-405c-9dee-73cde7a6fb32',
  //   AGENTS_GROUP:      'bb7d859f-7032-405c-9dee-73cde7a6fb22',
  // },
};

module.exports = { GROUPS };
