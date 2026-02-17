import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { FileConfigStore } from '../../../config/file-config-store';
import { ConfigService } from '../../../config/config.service';
import { StateHydratorService } from '../state-hydrator.service';
import {
  CTPScheduler,
  CTPScoring,
  CTPScoringConfiguration,
  SolveStatistics,
  List,
  CTPTask,
} from '@ctp/engine';

describe('Acme Outpatient Hydrator', () => {
  const configRoot = path.resolve(__dirname, '..', '..', '..', '..', '..', '..', 'config');

  it('builds landscape for acme-outpatient', () => {
    const store = new FileConfigStore(configRoot, 'acme-outpatient');
    const configService = new ConfigService(store);
    const hydrator = new StateHydratorService(configService);
    const landscape = hydrator.buildLandscape();
    expect(landscape.resources.size()).toBe(17);
    expect(landscape.tasks.size()).toBe(30);
  });

  it('solves acme-outpatient without error', () => {
    const store = new FileConfigStore(configRoot, 'acme-outpatient');
    const configService = new ConfigService(store);
    const hydrator = new StateHydratorService(configService);
    const landscape = hydrator.buildLandscape();

    // Constraint propagation
    landscape.propagateConstraints();

    // Build scoring
    const scoringConfig = configService.getScoring();
    expect(scoringConfig).toBeTruthy();
    const scoring = new CTPScoring(scoringConfig!.name, scoringConfig!.key);
    for (const rule of scoringConfig!.rules) {
      const config = new CTPScoringConfiguration(
        rule.ruleName,
        rule.weight,
        rule.objective,
      );
      config.includeInSolve = rule.includeInSolve;
      config.penaltyFactor = rule.penaltyFactor;
      scoring.addConfig(config);
    }

    // Init scheduler
    const scheduler = new CTPScheduler();
    scheduler.initLandscape(
      landscape.horizon,
      landscape.tasks,
      landscape.resources,
      landscape.stateChanges,
      landscape.processes,
    );
    scheduler.initSettings(landscape.appSettings);
    scheduler.initScoring(scoring);

    // Build task list
    const taskList = new List<CTPTask>();
    landscape.tasks.forEach((t) => taskList.add(t));

    // Run solver
    scheduler.schedule(taskList);

    // Should complete without throwing
    expect(taskList.length).toBeGreaterThan(0);
  });
});
