import { CTPAppSettings } from "../Models/Entities/appsettings";
import { CTPStateChange } from "../Models/Entities/statechange";
import { CTPHorizon } from "../Models/Entities/horizon";
import { CTPResource, CTPResources } from "../Models/Entities/resource";
import { CTPScoring } from "../Models/Entities/score";
import { CTPTask, CTPTasks } from "../Models/Entities/task";
import { CTPTimeline } from "../Models/Entities/timeline";
import * as fs from "../Services/getdatafromfile";

export interface IAPIService {
  setbaseURL(url: string): void;
  getAllTimelines(): string[];
  getResources(tl: string, param?: any): CTPResource[];
  getTasks(tl: string, param?: any): CTPTask[];
  getStateTasks(tl: string, param?: any): CTPTask[];
  getHorizon(tl: string, param?: any): CTPHorizon;
  getScorings(tl: string, param?: any): CTPScoring[];
  getTimeline(tl: string, param?: any): CTPTimeline;
  getAppSettings(tl: string, param?: any): CTPAppSettings;
  getStateChanges(tl: string, param?: any): CTPStateChange[];
  getStateTasks(tl: string, param?: any): CTPTask[];

  updateResources(tl: string, resources: CTPResource[]): void;
  updateTasks(tl: string, tasks: CTPTask[]): void;
  updateHorizon(tl: string, hor: CTPHorizon): void;
  updateScorings(tl: string, scoring: CTPScoring[]): void;
  updateStateChanges(tl: string, scoring: CTPStateChange[]): void;
  updateStateTasks(tl: string, state: CTPTask[]): void;
  updateTimeline(tl: CTPTimeline): void;
  updateAppSettings(tl: string, settings: CTPAppSettings): void;
}

export class APIServiceFromFile implements IAPIService {
  path: string;

  constructor(path: string) {
    this.path = path;
  }
  public setbaseURL(url: string) {
    this.path = url;
  }
  public setTimelineURL(tl: string) {
    if (tl) fs.setPath(this.path + "/" + tl);
    else fs.setPath(this.path);
  }
  public getAllTimelines(): string[] {
    fs.setPath(this.path);
    return fs.readAllTimesline();
  }
  public getResources(tl: string, param?: any): CTPResource[] {
    this.setTimelineURL(tl);
    return fs.readResources(param);
  }
  public getTasks(tl: string, param?: any): CTPTask[] {
    this.setTimelineURL(tl);
    return fs.readTasks(param);
  }
  public getStateTasks(tl: string, param?: any): CTPTask[] {
    this.setTimelineURL(tl);
    return fs.readStateTasks(param);
  }
  public getStateChanges(tl: string, param?: any): CTPStateChange[] {
    this.setTimelineURL(tl);
    return fs.readStateChanges(param);
  }
  public getHorizon(tl: string, param?: any): CTPHorizon {
    this.setTimelineURL(tl);
    return fs.readHorizon(param);
  }
  public getScorings(tl: string, param?: any): CTPScoring[] {
    this.setTimelineURL(tl);
    return fs.readScorings(param);
  }

  public getAppSettings(tl: string, param?: any): CTPAppSettings {
    this.setTimelineURL(tl);
    return fs.readAppSettings(param);
  }
  public getTimeline(tl: string, param?: any): CTPTimeline {
    this.setTimelineURL(tl);
    return fs.readTimeline(param);
  }
  public updateResources(tl: string, resources: CTPResource[]): void {
    this.setTimelineURL(tl);
    fs.writeResources(resources);
  }

  public updateTasks(tl: string, resources: CTPTask[]): void {
    this.setTimelineURL(tl);
    fs.writeTasks(resources);
  }
  public updateStateTasks(tl: string, state: CTPTask[]): void {
    this.setTimelineURL(tl);
    fs.writeStateTasks(state);
  }
  public updateStateChanges(tl: string, resources: CTPStateChange[]): void {
    this.setTimelineURL(tl);
    fs.writeStateChanges(resources);
  }
  public updateHorizon(tl: string, hor: CTPHorizon): void {
    this.setTimelineURL(tl);
    fs.writeHorizon(hor);
  }
  public updateScorings(tl: string, scoring: CTPScoring[]): void {
    this.setTimelineURL(tl);
    fs.writeScorings(scoring);
  }
  public updateTimeline(tl: CTPTimeline): void {
    this.setTimelineURL(tl.name);
    fs.writeTimeline(tl);
  }
  public updateAppSettings(tl: string, settings: CTPAppSettings): void {
    this.setTimelineURL(tl);
    fs.writeAppSettings(settings);
  }

  public updateLandscape(
    tl: CTPTimeline,
    horiozn: CTPHorizon,
    settings: CTPAppSettings,
    resources: CTPResource[],
    tasks: CTPTask[],
    statechanges: CTPStateChange[],
    stateTasks: CTPTask[],
  ) {
    this.updateTimeline(tl);
    this.updateHorizon(tl.name, horiozn);
    this.updateAppSettings(tl.name, settings);
    this.updateResources(tl.name, resources);
    this.updateTasks(tl.name, tasks);
    this.updateStateTasks(tl.name, stateTasks);
    this.updateStateChanges(tl.name, statechanges);
  }
}
