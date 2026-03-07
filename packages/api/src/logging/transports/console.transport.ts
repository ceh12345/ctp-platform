import { LogTransport } from './transport.interface';
import { LogEvent } from '../events';

export class ConsoleTransport implements LogTransport {
  name = 'console';

  write(event: LogEvent): void {
    // Structured JSON — one line per event, easy to grep
    console.log(JSON.stringify({
      ...event,
      _transport: 'console',
    }));
  }
}
