#!/usr/bin/env node
// strip-envelope.js
//
// Post-capture helper: promote a recording directory into fixture-serve format.
//
// For each `.json` file in the target directory:
//   - If the content is a Genius envelope `{ Result: [...], ... }`, replace
//     the file content with just the `Result` array.
//   - If multi-page files (`{entity}_page1.json`, `{entity}_page2.json`, ...)
//     exist, merge their `Result` arrays in page order into a single
//     `{entity}.json` and delete the per-page files.
//   - If the content is already an array (hand-edited fixture), leave it alone.
//   - Preserve `_metadata.json` — it stays as reference for what was captured.
//
// Idempotent: running it twice on the same directory produces the same output
// as running it once.

const fs   = require('fs');
const path = require('path');

function main() {
  const targetDir = process.argv[2];
  if (!targetDir) {
    console.error('Usage: node strip-envelope.js <directory>');
    process.exit(1);
  }
  const absDir = path.resolve(targetDir);
  if (!fs.existsSync(absDir) || !fs.statSync(absDir).isDirectory()) {
    console.error(`Not a directory: ${absDir}`);
    process.exit(1);
  }

  stripDirectory(absDir);
}

function stripDirectory(dir) {
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  const paged  = groupPagedFiles(files);
  const single = files.filter(f => !paged.has(f) && !isPageFile(f));

  for (const [entity, pages] of paged.entries()) {
    mergePagedEntity(dir, entity, pages);
  }

  for (const f of single) {
    if (f === '_metadata.json') continue;
    stripSingleFile(dir, f);
  }
}

// Returns a Map<entityName, [pageN, pageN+1, ...]> of files that look paged.
// Also returns a set of filenames that are covered by the map.
function groupPagedFiles(files) {
  const groups = new Map();
  for (const f of files) {
    const m = f.match(/^(.+?)_page(\d+)\.json$/);
    if (!m) continue;
    const entity = m[1];
    const page   = parseInt(m[2], 10);
    if (!groups.has(entity)) groups.set(entity, []);
    groups.get(entity).push({ file: f, page });
  }
  // sort each group by page
  const sortedGroups = new Map();
  for (const [entity, pages] of groups.entries()) {
    pages.sort((a, b) => a.page - b.page);
    sortedGroups.set(entity, pages);
  }
  return sortedGroups;
}

function isPageFile(f) {
  return /^(.+?)_page(\d+)\.json$/.test(f);
}

function mergePagedEntity(dir, entity, pages) {
  const mergedRecords = [];
  for (const { file } of pages) {
    const raw = fs.readFileSync(path.join(dir, file), 'utf-8');
    const parsed = safeParse(raw);
    const records = extractArray(parsed);
    if (records) mergedRecords.push(...records);
  }
  const outPath = path.join(dir, `${entity}.json`);
  fs.writeFileSync(outPath, JSON.stringify(mergedRecords, null, 2));
  for (const { file } of pages) {
    fs.unlinkSync(path.join(dir, file));
  }
  console.log(`${entity}.json: merged ${pages.length} page(s), ${mergedRecords.length} record(s) total (removed per-page files)`);
}

function stripSingleFile(dir, file) {
  const filePath = path.join(dir, file);
  const raw = fs.readFileSync(filePath, 'utf-8');
  const parsed = safeParse(raw);

  if (parsed === null) {
    console.log(`${file}: unparseable JSON, skipping`);
    return;
  }
  if (Array.isArray(parsed)) {
    console.log(`${file}: already an array, skipping`);
    return;
  }
  if (Array.isArray(parsed?.Result)) {
    fs.writeFileSync(filePath, JSON.stringify(parsed.Result, null, 2));
    console.log(`${file}: ${parsed.Result.length} record(s) extracted from envelope`);
    return;
  }
  console.log(`${file}: no Result field, skipping`);
}

function safeParse(raw) {
  try { return JSON.parse(raw); } catch { return null; }
}

function extractArray(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.Result)) return parsed.Result;
  return null;
}

main();
