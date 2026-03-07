import * as fs from 'fs';
import * as path from 'path';
import { LogTransport } from './transport.interface';
import { LogEvent } from '../events';

export class FileTransport implements LogTransport {
  name = 'file';
  private logDir: string;
  private currentDate: string;
  private currentFile: string;

  constructor(logDir = './logs') {
    this.logDir = logDir;
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    this.currentDate = new Date().toISOString().split('T')[0];
    this.currentFile = path.join(logDir, `${this.currentDate}.jsonl`);
  }

  write(event: LogEvent): void {
    // Rotate file on day change
    const today = new Date().toISOString().split('T')[0];
    if (today !== this.currentDate) {
      this.currentDate = today;
      this.currentFile = path.join(this.logDir, `${today}.jsonl`);
    }
    const line = JSON.stringify(event) + '\n';
    fs.appendFileSync(this.currentFile, line, 'utf8');
  }
}
