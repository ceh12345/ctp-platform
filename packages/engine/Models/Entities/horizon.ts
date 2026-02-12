import { CTPDateTime } from "../Core/date";
import { DateTime, Interval, Settings } from "luxon";
import { CTPEntity, IEntity } from "../Core/entity";

export interface IHorizonDTO extends IEntity {
  startDate: DateTime;
  endDate: DateTime;
}
export class CTPHorizon extends CTPEntity implements IHorizonDTO {
  public startDate: DateTime;
  public endDate: DateTime;
  public startW: number;
  public endW: number;

  constructor(st?: DateTime, et?: DateTime) {
    super();
    this.startDate = CTPDateTime.now();
    this.endDate = CTPDateTime.now();

    if (st) this.startDate = CTPDateTime.cleanseDate(st);
    if (et) this.endDate = CTPDateTime.cleanseDate(et);
    this.startW = CTPDateTime.fromDateTime(this.startDate);
    this.endW = CTPDateTime.fromDateTime(this.endDate);
  }

  public get duration(): number {
    return this.endW - this.startW;
  }

  public set(st: DateTime, et: DateTime) {
    this.startDate = CTPDateTime.cleanseDate(st);
    this.endDate = CTPDateTime.cleanseDate(et);
    this.startW = CTPDateTime.fromDateTime(st);
    this.endW = CTPDateTime.fromDateTime(et);
  }
  public debug() {
    const str =
      this.startDate.toFormat("ccc LLL dd yyyy HH:mm:ss ") +
      " - " +
      this.endDate.toFormat("ccc LLL dd yyyy HH:mm:ss ");
    console.log("Horizon:" + str);
  }
}

export class CTPRollingHorizon extends CTPHorizon {
  public daysBefore: number = 0;
  public daysAfter: number = 0;

  constructor(st: DateTime, daysB: number, daysA: number) {
    super(st.minus({ days: daysB }), st.plus({ days: daysA }));
    this.daysBefore = daysB;
    this.daysAfter = daysA;
  }
}
