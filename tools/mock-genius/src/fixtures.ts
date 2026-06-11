import * as fs from 'fs';
import * as path from 'path';

const FIXTURES_DIR = process.env.MOCK_FIXTURES_DIR ?? path.join(__dirname, '..', 'fixtures');
export const DEFAULT_SCENARIO = process.env.MOCK_SCENARIO ?? 'stafford-snapshot-2026-06-03';
let activeScenario = DEFAULT_SCENARIO;

export function getScenario(): string {
  return activeScenario;
}

export function resetScenario(): void {
  activeScenario = DEFAULT_SCENARIO;
}

export function setScenario(scenario: string): void {
  const scenarioDir = path.join(FIXTURES_DIR, scenario);
  if (!fs.existsSync(scenarioDir)) {
    throw new Error(`Scenario not found: ${scenario}`);
  }
  activeScenario = scenario;
}

// Returns the fixture array for an entity, or [] if the file doesn't exist.
// Missing files are valid — they mean "no data for this entity in this scenario."
export function loadFixture(entityName: string): unknown[] {
  const filePath = path.join(FIXTURES_DIR, activeScenario, `${entityName}.json`);
  if (!fs.existsSync(filePath)) {
    return [];
  }
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as unknown[];
}
