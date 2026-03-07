import { LogEvent } from '../events';

export interface LogTransport {
  write(event: LogEvent): void | Promise<void>;
  name: string;
}
