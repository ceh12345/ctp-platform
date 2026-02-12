"strict";
import { DateTime } from "luxon";
import { CTPInterval } from "../Core/window";
import { CTPAppSettings, IAppSettings } from "./appsettings";
import { CTPHorizon } from "./horizon";
import { CTPTasks } from "./task";
import { CTPResource, CTPResources } from "./resource";
import { CTPProcess, CTPProcesses } from "./process";
import { CTPStateChanges } from "./statechange";

export interface ILandscape {
  horizon: CTPHorizon | null;
  tasks: CTPTasks | null;
  resources: CTPResources | null;
  processes: CTPProcesses | null;
  appSettings: CTPAppSettings | null;
  stateChanges: CTPStateChanges | null;
  stateTasks: CTPTasks | null;

}

export class SchedulingLandscape implements ILandscape {
  public horizon: CTPHorizon;
  public tasks: CTPTasks;
  public resources: CTPResources;
  public processes: CTPProcesses;
  public stateChanges: CTPStateChanges;
  public stateTasks: CTPTasks;
  
  public appSettings: CTPAppSettings | null = null;

  public setSettings(a: CTPAppSettings): void {
    this.appSettings = a;
  }

  public setHorizon(st: DateTime, et: DateTime) {
    this.horizon.set(st, et);
  }

  // Build Tasks that are linked together
  public buildProcesses()
  {
      if (!this.processes) this.processes = new CTPProcesses();
      this.processes.clear();

      if (this.tasks)
      {
          this.tasks.forEach(t => {
              if (t.hasLinkId() && t.linkId?.name)
              {

                  let newP = this.processes.getEntity(t.linkId.name);

                  if (!newP)
                  {
                      newP = new CTPProcess(t.linkId.name);
                      this.processes.addEntity(newP);
                  }
                  newP.tasks?.add(t);
              }
          });
          this.processes.forEach(p => {
              p.tasks?.sort();
          });

      }
  }
  constructor(s?: DateTime, e?: DateTime, a?: CTPAppSettings) {
    this.horizon = new CTPHorizon(s, e);
    this.tasks = new CTPTasks();
    this.resources = new CTPResources();
    this.processes = new CTPProcesses();
    this.stateChanges = new CTPStateChanges();
    this.stateTasks = new CTPTasks();
    if (s !== undefined && e !== undefined) this.setHorizon(s, e);
    if (a) this.setSettings(a);
    else this.appSettings = new CTPAppSettings();
  }
}
