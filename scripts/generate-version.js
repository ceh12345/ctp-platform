const { execSync } = require('child_process');
const pkg = require('../package.json');
const fs = require('fs');
const path = require('path');

let gitHash = 'unknown';
let gitBranch = 'unknown';
try {
  gitHash = execSync('git rev-parse --short HEAD').toString().trim();
  gitBranch = execSync('git rev-parse --abbrev-ref HEAD').toString().trim();
} catch { /* git not available */ }

const versionInfo = {
  version: pkg.version,
  gitHash,
  gitBranch,
  buildDate: new Date().toISOString(),
  fullVersion: `${pkg.version}-${gitHash}`,
};

// Write to API src (NestJS copies JSON via resolveJsonModule)
const apiDest = path.join(__dirname, '..', 'packages', 'api', 'src', 'version.json');
fs.writeFileSync(apiDest, JSON.stringify(versionInfo, null, 2));

console.log(`Version: ${versionInfo.fullVersion}`);
