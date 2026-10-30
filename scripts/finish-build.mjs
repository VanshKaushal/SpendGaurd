import { writeFileSync } from 'node:fs';
writeFileSync(new URL('../dist/.npmignore',import.meta.url),'**/test/\nvitest.config.*\n**/*.js.map\n**/*.tsbuildinfo\n');
