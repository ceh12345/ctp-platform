"strict";
import { DateTime, Interval, Settings } from "luxon";

export class CTPDateTime {
  public static readonly baseDate: DateTime = this.fromString("2010-01-01");

  public static readonly ONE_DAY = 86400;
  public static readonly ONE_HOUR = 3600;
  public static readonly ONE_MINUTE = 60;

  public static fromString(dt: string): DateTime {
    return this.cleanseDate(dt);
  }
  public static cleanseDate(dt: DateTime | string): DateTime {
    if (typeof dt === "string")
      return DateTime.fromISO(dt).set({ millisecond: 0 });
    return dt;
  }

  public static toDateTime(sec: number): DateTime {
    return this.baseDate.plus({ seconds: sec });
  }
  public static fromDateTime(dt: DateTime | string): number {
    let i = Interval.fromDateTimes(this.baseDate, this.cleanseDate(dt));

    return i.length("seconds");
  }
  public static now(): DateTime {
    return this.cleanseDate(DateTime.now().set({ millisecond: 0 }));
  }
  public static dateNow(): DateTime {
    return this.now().set({
      hour: 0,
      minute: 0,
      second: 0,
      millisecond: 0,
    });
  }
  private constructor() {
    /* noop */
  }
}

export class CTPPersist {
  public createDate: DateTime;
  public updateDate: DateTime;
  public lastUser: string;
  public updateMode: number = 0;

  constructor() {
    this.createDate = CTPDateTime.now();
    this.updateDate = CTPDateTime.now();
    this.lastUser = "";
    this.updateMode = 0;
  }
}
