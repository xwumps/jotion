// Version aus package.json (zur Laufzeit gelesen, damit rootDir src bleibt)
// eslint-disable-next-line @typescript-eslint/no-require-imports
export const API_VERSION: string = (require('../package.json') as { version: string }).version;
