import { writeFile } from 'node:fs/promises';
import { stringify } from 'yaml';
import { openApiDocument } from '../src/docs/openapi.js';

const destination = new URL('../specs/001-inventory-reservations/contracts/openapi.yaml', import.meta.url);
await writeFile(destination, stringify(openApiDocument, { lineWidth: 0 }), 'utf8');
