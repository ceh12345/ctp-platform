import { Injectable } from '@nestjs/common';
import { LogTransport } from './transport.interface';
import { LogEvent } from '../events';

const MAX_EVENTS = 200;

@Injectable()
export class MemoryTransport implements LogTransport {
  name = 'memory';
  private events: LogEvent[] = [];

  write(event: LogEvent): void {
    this.events.push(event);
    if (this.events.length > MAX_EVENTS) {
      this.events.shift();
    }
  }

  getEvents(type?: string, limit = 100): LogEvent[] {
    const filtered = type
      ? this.events.filter(e => e.type === type)
      : this.events;
    return filtered.slice(-limit);
  }

  clear(): void {
    this.events = [];
  }

  getSummary() {
    const aiCalls = this.events.filter(e => e.type === 'ai_call');
    const solves = this.events.filter(e => e.type === 'solve');
    const errors = this.events.filter(e => e.type === 'api_error');
    const systemErrors = this.events.filter(e => e.type === 'system_error');
    return {
      totalEvents: this.events.length,
      aiCalls: aiCalls.length,
      solves: solves.length,
      errors: errors.length,
      systemErrors: systemErrors.length,
      oldestEvent: this.events[0]?.timestamp ?? null,
      newestEvent: this.events[this.events.length - 1]?.timestamp ?? null,
    };
  }
}
