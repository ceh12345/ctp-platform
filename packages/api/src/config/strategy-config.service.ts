import { Injectable } from '@nestjs/common';
import { ConfigService } from './config.service';
import { StrategyConfig } from './interfaces/strategy.interface';
import { GLOBAL_STRATEGIES, DEFAULT_STRATEGY_KEY } from './strategy-defaults';

@Injectable()
export class StrategyConfigService {
  constructor(private readonly configService: ConfigService) {}

  /**
   * Merge global defaults + tenant overrides + custom strategies.
   * Returns only enabled, public strategies sorted by sortOrder.
   */
  getStrategiesForTenant(): { strategies: StrategyConfig[]; defaultStrategy: string } {
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

    return { strategies, defaultStrategy: DEFAULT_STRATEGY_KEY };
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
