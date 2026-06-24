import { Injectable } from '@nestjs/common';
import { ConfigService } from './config.service';
import { StrategyConfig, SolverTierConfig } from './interfaces/strategy.interface';
import { GLOBAL_STRATEGIES, DEFAULT_STRATEGY_KEY, SOLVER_TIERS, DEFAULT_TIER_KEY } from './strategy-defaults';

@Injectable()
export class StrategyConfigService {
  constructor(private readonly configService: ConfigService) {}

  /**
   * Merge global defaults + tenant overrides + custom strategies.
   * Returns only enabled, public strategies sorted by sortOrder.
   */
  getStrategiesForTenant(): {
    strategies: StrategyConfig[];
    defaultStrategy: string;
    tiers: SolverTierConfig[];
    defaultTier: string;
    sequences: { name: string; displayName: string; summary: string }[];
    defaultSequence: string;
  } {
    const overrides = this.configService.getStrategyOverrides();
    const customs = this.configService.getCustomStrategies();

    // 1. Deep-copy globals
    const merged: StrategyConfig[] = GLOBAL_STRATEGIES.map(g => ({ ...g }));

    // 2. Apply tenant overrides
    const overrideMap = new Map(overrides.map(o => [o.strategyKey, o]));
    for (const strategy of merged) {
      const override = overrideMap.get(strategy.key);
      if (!override) continue;
      if (override.label !== undefined) strategy.label = override.label;
      if (override.icon !== undefined) strategy.icon = override.icon;
      if (override.short !== undefined) strategy.short = override.short;
      if (override.detail !== undefined) strategy.detail = override.detail;
      if (override.bestFor !== undefined) strategy.bestFor = override.bestFor;
      if (override.time !== undefined) strategy.time = override.time;
      if (override.enabled !== undefined) strategy.enabled = override.enabled;
    }

    // 3. Append enabled custom strategies
    for (const custom of customs) {
      if (!custom.enabled) continue;
      merged.push({
        key: custom.key,
        label: custom.label,
        icon: custom.icon,
        short: custom.short,
        detail: custom.detail,
        bestFor: custom.bestFor,
        time: custom.time,
        enabled: true,
        isGlobal: false,
        isPublic: true,
        sortOrder: custom.sortOrder,
        tier: custom.tier,
      });
    }

    // 4. Filter disabled/private, sort by sortOrder
    const strategies = merged
      .filter(s => s.enabled && s.isPublic)
      .sort((a, b) => a.sortOrder - b.sortOrder);

    // Tiers — deep-copy, filter enabled, sort
    const tiers = SOLVER_TIERS
      .filter(t => t.enabled)
      .map(t => ({ ...t }))
      .sort((a, b) => a.sortOrder - b.sortOrder);

    // Use tenant's configured solverStrategy as default, falling back to global default
    const tenantStrategy = this.configService.getSettings()?.solverStrategy;
    const defaultStrategy = tenantStrategy && strategies.some(s => s.key === tenantStrategy)
      ? tenantStrategy
      : DEFAULT_STRATEGY_KEY;

    // Processing Sequences — demand-prioritisation sequences selectable per solve.
    // List the tenant's configured sequences + the always-available platform default.
    const profile = this.configService.getMappingProfile?.();
    const sequences = (profile?.processingSequences ?? []).map(s => ({
      name: s.name,
      displayName: s.displayName ?? s.name,
      summary: (s.criteria ?? []).map(c => `${c.field} ${c.direction ?? 'asc'}`).join(', '),
    }));
    // Only surface the platform default when the tenant declares no sequences of
    // its own — otherwise it's a redundant duplicate of the tenant's sequence.
    if (sequences.length === 0) {
      sequences.push({ name: 'platform-default', displayName: 'Work Order Priority (platform default)', summary: 'order.priority asc' });
    }
    const defaultSequence = profile?.defaultSequence || 'platform-default';

    return { strategies, defaultStrategy, tiers, defaultTier: DEFAULT_TIER_KEY, sequences, defaultSequence };
  }

  /** Check if a strategy key is available for the current tenant. */
  validateStrategy(strategyKey: string): boolean {
    const { strategies } = this.getStrategiesForTenant();
    return strategies.some(s => s.key === strategyKey);
  }

  /**
   * Get the engine handler key for a given strategy.
   * For globals, the key maps directly. For customs, use the handler field.
   */
  getEngineStrategy(strategyKey: string): string {
    const customs = this.configService.getCustomStrategies();
    const custom = customs.find(c => c.key === strategyKey && c.enabled);
    if (custom) return custom.handler;
    return strategyKey;
  }
}
