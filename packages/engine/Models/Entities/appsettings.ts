"strict";

import { CTPScheduleDirectionConstants } from "../Core/constants";

export interface IAppSettings {
  flowAround: boolean;
  maxLateness: number;
  tasksPerLoop: number;
  resetUageAfterProcessChange: boolean;
  scheduleDirection: number,
  requiresPreds: boolean;
  
}

export class CTPAppSettings implements IAppSettings {
  public flowAround: boolean = false;
  public maxLateness: number = 0;
  public tasksPerLoop: number = 50;
  public topTasksToSchedule: number = 2;
  public resetUageAfterProcessChange: boolean = true;
  public scheduleDirection: number = CTPScheduleDirectionConstants.FORWARD;
  public requiresPreds: boolean = false;
}

export interface ITimingSetting {
  fromTiming: string;
  toTiming: string;
}

export const StartToStartTiming = {
  fromTiming: "START",
  toTiming: "START",
};

export const EndToStartTiming = {
  fromTiming: "END",
  toTiming: "START",
};

export const CTPAppColors = {
  unavailable: "red",
  process: "blue",
  setup: "yellow",
  available: "green",
  teardown: "yellow",
  maintenance: "red",
};
