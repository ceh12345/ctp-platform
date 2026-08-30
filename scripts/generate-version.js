const { execSync } = require('child_process');
const pkg = require('../package.json');
const fs = require('fs');
const path = require('path');

// Env overrides let git-less builds (e.g. the Docker image, whose context
// excludes .git) still stamp a real hash via --build-arg.
let gitHash = process.env.GIT_HASH || 'unknown';
let gitBranch = process.env.GIT_BRANCH || 'unknown';
if (!process.env.GIT_HASH) {
  try {
    gitHash = execSync('git rev-parse --short HEAD').toString().trim();
    gitBranch = execSync('git rev-parse --abbrev-ref HEAD').toString().trim();
  } catch { /* git not available */ }
}

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
