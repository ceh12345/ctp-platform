import { Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';
import { ConfigService } from './config.service';

export type ClockMode = 'rolling' | 'fixed';

/**
 * The single evaluation clock ("as of") for the active tenant.
 *
 * Every time-relative status/lateness computation must read `asOf()` instead of
 * `Date.now()`, so a fixed (snapshot) dataset evaluates against its pinned
 * as-of while a rolling (live) dataset tracks real time. The mode is derived
 * from the SAME horizon anchor that drives the scheduler
 * (`IHorizonConfig.start`), so the evaluation clock and the horizon can never
 * disagree:
 *   - rolling (`'NOW'` / `'NOW±Nd'`) -> `asOf = Date.now()`  (live data, live clock)
 *   - fixed   (an ISO date)          -> `asOf = that date`   (frozen data, frozen clock)
 *
 * Operational time (perf timers, id generation, log stamps, TTLs) MUST keep
 * using `Date.now()` directly — this service is for domain-time evaluation only.
 *
 * See docs/sprints/SPRINT-evaluation-clock.md.
 */
@Injectable()
export class ClockService {
  constructor(private readonly configService: ConfigService) {}

  private timezone(): string {
    return this.configService.getLocale()?.timezone || 'UTC';
  }

  /** `'rolling'` when the horizon anchor is NOW-relative, else `'fixed'`. */
  mode(): ClockMode {
    const start = this.configService.getHorizon()?.start || 'NOW';
    return start.toUpperCase().startsWith('NOW') ? 'rolling' : 'fixed';
  }

  /** The evaluation instant for the active tenant. */
  asOf(): DateTime {
    const tz = this.timezone();
    if (this.mode() === 'rolling') return DateTime.now().setZone(tz);
    // Fixed: the horizon anchor is the as-of. A provenance `asOf` field takes
    // precedence when present; falls back to the anchor date for back-compat.
    const horizon = this.configService.getHorizon();
    const iso = (horizon as any)?.asOf ?? horizon?.start ?? '';
    const parsed = DateTime.fromISO(iso, { zone: tz });
    return parsed.isValid ? parsed : DateTime.now().setZone(tz);
  }

  /** Evaluation instant as epoch milliseconds (matches `Date.now()`). */
  asOfMs(): number {
    return this.asOf().toMillis();
  }

  /** Evaluation instant as epoch seconds (the engine's working unit). */
  asOfSeconds(): number {
    return Math.floor(this.asOf().toSeconds());
  }
}
