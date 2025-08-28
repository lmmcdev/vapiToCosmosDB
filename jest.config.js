module.exports = {
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/tests/setupEnv.js'],
  moduleFileExtensions: ['js', 'json'],
  // Ajusta rutas si tu estructura difiere
  moduleNameMapper: {
    '^../shared/(.*)$': '<rootDir>/src/functions/shared/$1',
    '^./auth/(.*)$': '<rootDir>/src/functions/auth/$1', // ajusta si es otro directorio
    '^./dtos/(.*)$': '<rootDir>/src/functions/dtos/$1'
  }
};
