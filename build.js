const fs = require('fs');
const path = require('path');

const root = __dirname;
const srcDir = path.join(root, 'src');
const outDir = path.join(srcDir, 'background');
const outFile = path.join(outDir, 'service_worker.bundle.js');

const source = fs.readFileSync(path.join(outDir, 'service_worker.js'), 'utf8');
fs.writeFileSync(outFile, source);
console.log('Built', path.relative(root, outFile));
