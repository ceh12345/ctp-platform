import * as fs from "fs";
import {
  CTPBaseResource,
  CTPResource,
  CTPResources,
} from "../Models/Entities/resource";
import {
  CTPTask,
  CTPTaskResource,
  CTPTaskResourceList,
  CTPTasks,
} from "../Models/Entities/task";
import {
  CTPAssignments,
  CTPAvailable,
  CTPIntervals,
} from "../Models/Intervals/intervals";
import { SchedulingLandscape } from "../Models/Entities/landscape";
import { CTPHorizon } from "../Models/Entities/horizon";
import { CTPScoring } from "../Models/Entities/score";
import { CTPTimeline } from "../Models/Entities/timeline";
import { CTPAppSettings } from "../Models/Entities/appsettings";
import { DateTime } from "luxon";
import { CTPDuration, CTPInterval } from "../Models/Core/window";
import { CTPDateTime } from "../Models/Core/date";
import { AvailableMatrix } from "../Models/Intervals/availablematrix";
import { CTPStateChange } from "../Models/Entities/statechange";

var path = "";

function toISOString(sec: number | DateTime | string): string | null {
  if (sec instanceof DateTime) return sec.toUTC().toISO();
  if (typeof sec === "string")
    return CTPDateTime.cleanseDate(sec).toUTC().toISO();
  return CTPDateTime.toDateTime(sec as number)
    .toUTC()
    .toISO();
}
function fromISOString(str: string): number {
  return CTPDateTime.fromDateTime(str);
}
function createDirectory(path: string) {
  fs.mkdir(path, { recursive: true }, (err) => {
    if (err) throw err;
  });
}
function readFromFile(file: string): string {
  let data = "";
  try {
    data = fs.readFileSync(file, "utf-8");
  } catch (err) {
    console.error(err);
    return "";
  }
  return data;
}

export function setPath(p: string): void {
  path = p;
  createDirectory(p);
}

export function readAllTimesline(): string[] {
  try {
    const items = fs.readdirSync(path, { withFileTypes: true });
    const directories = items.map((dir) => dir.name);

    return directories;
  } catch (err) {
    console.error(`Error reading directories from location: ${path}`, err);
    return [];
  }
}

export function readResources(param?: any): CTPResource[] {
  var data = readFromFile(path + "//resources.json");
  var resources: CTPResource[] = [];
  // Ignore Link Lists

  if (!data || data.length === 0) return resources;

  resources = JSON.parse(data, (key, value) => {
    if (key.includes("startW") || key.includes("endW"))
      return fromISOString(value);
    if (key === "available") {
      return undefined; // Skip the "available" field
    }

    return value;
  });

  // Map JSON objects to CTPResource instances
  resources = resources.map((res: any) => {
    const resource = new CTPResource();
    Object.assign(resource, res);

    // If the resource has nested objects, map them to their respective classes
    if (res.original) {
      resource.original = new CTPAvailable();
      res.original.forEach((r: any) => {
        const taskResource = new CTPInterval();
        Object.assign(taskResource, r);
        resource.original?.add(taskResource);
      });
    }

    if (res.assignments) {
      resource.assignments = new CTPAssignments();
      res.assignments.forEach((r: any) => {
        const taskResource = new CTPInterval();
        Object.assign(taskResource, r);
        resource.assignments?.add(taskResource);
      });
    }

    resource.available = new AvailableMatrix();

    return resource;
  });

  return resources;
}
export function writeResources(resources: CTPResource[]) {
  var rwResources: any[] = [];
  // Ignore Link Lists
  resources?.forEach((res) => {
    const jsonString = JSON.stringify(res, (key, value) => {
      if (key == "available") {
        return [];
      }
      if (key == "original")
        return res.original?.toArray().sort((a, b) => a.startW - b.startW);
      if (key == "assignments")
        return res.assignments?.toArray().sort((a, b) => a.startW - b.startW);
      if (key.includes("startW") || key.includes("endW"))
        return toISOString(value);

      return value;
    });
    const base: any = JSON.parse(jsonString);
    rwResources.push(base);
  });

  fs.writeFile(
    path + "/resources.json",
    JSON.stringify(rwResources),
    function (err) {
      if (err) {
        return console.error(err);
      }
      console.log("File created!");
    },
  );
}

export function readTasks(param?: any): CTPTask[] {
  var data = readFromFile(path + "//tasks.json");

  if (!data || data.length === 0) return [] as CTPTask[];

  var tasks: CTPTask[] = JSON.parse(data, (key, value) => {
    if (key.includes("startW") || key.includes("endW"))
      return fromISOString(value);

    return value;
  });

  // Map JSON objects to CTPResource instances
  tasks = tasks.map((res: any) => {
    const resource = new CTPTask();
    Object.assign(resource, res);

    resource.window = new CTPInterval();
    Object.assign(resource.window, res.window);
    resource.scheduled = new CTPInterval();
    Object.assign(resource.scheduled, res.scheduled);
    resource.duration = new CTPDuration();
    Object.assign(resource.duration, res.duration);

    resource.capacityResources = new CTPTaskResourceList();
    if (res.capacityResources)
      res.capacityResources.forEach((r: any) => {
        const taskResource = new CTPTaskResource();
        Object.assign(taskResource, r);
        resource.capacityResources?.add(taskResource);
      });
    resource.materialsResources = new CTPTaskResourceList();
    if (res.materialsResources)
      res.materialsResources.forEach((r: any) => {
        const taskResource = new CTPTaskResource();
        Object.assign(taskResource, r);
        resource.materialsResources?.add(taskResource);
      });
    resource.capacityResources?.sortBySequence();
    resource.materialsResources?.sortBySequence();

    // If the resource has nested objects, map them to their respective classes
    return resource;
  });

  return tasks;
}
export function readStateTasks(param?: any): CTPTask[] {
  var data = readFromFile(path + "//statetasks.json");

  if (!data || data.length === 0) return [] as CTPTask[];

  var tasks: CTPTask[] = JSON.parse(data, (key, value) => {
    if (key.includes("startW") || key.includes("endW"))
      return fromISOString(value);

    return value;
  });

  // Map JSON objects to CTPResource instances
  tasks = tasks.map((res: any) => {
    const resource = new CTPTask();
    Object.assign(resource, res);

    resource.window = new CTPInterval();
    Object.assign(resource.window, res.window);
    resource.scheduled = new CTPInterval();
    Object.assign(resource.scheduled, res.scheduled);
    resource.duration = new CTPDuration();
    Object.assign(resource.duration, res.duration);

    resource.capacityResources = new CTPTaskResourceList();
    if (res.capacityResources)
      res.capacityResources.forEach((r: any) => {
        const taskResource = new CTPTaskResource();
        Object.assign(taskResource, r);
        resource.capacityResources?.add(taskResource);
      });
    resource.materialsResources = new CTPTaskResourceList();
    if (res.materialsResources)
      res.materialsResources.forEach((r: any) => {
        const taskResource = new CTPTaskResource();
        Object.assign(taskResource, r);
        resource.materialsResources?.add(taskResource);
      });
    resource.capacityResources?.sortBySequence();
    resource.materialsResources?.sortBySequence();

    // If the resource has nested objects, map them to their respective classes
    return resource;
  });

  return tasks;
}
export function writeTasks(tasks: CTPTask[]) {
  const jsonString = JSON.stringify(tasks, (key, value) => {
    if (key.includes("startW") || key.includes("endW"))
      return toISOString(value);

    return value;
  });

 

  fs.writeFile(path + "/tasks.json", jsonString, function (err) {
    if (err) {
      return console.error(err);
    }
    console.log("File created!");
  });
}

export function writeStateTasks(tasks: CTPTask[]) {
  const jsonString = JSON.stringify(tasks, (key, value) => {
    if (key.includes("startW") || key.includes("endW"))
      return toISOString(value);

    return value;
  });

  fs.writeFile(path + "/statetasks.json", jsonString, function (err) {
    if (err) {
      return console.error(err);
    }
    console.log("File created!");
  });
}

export function writeStateChanges(tasks: CTPStateChange[]) {
  const jsonString = JSON.stringify(tasks, (key, value) => {
    if (key.includes("startW") || key.includes("endW"))
      return toISOString(value);

    return value;
  });

  fs.writeFile(path + "/statechanges.json", jsonString, function (err) {
    if (err) {
      return console.error(err);
    }
    console.log("File created!");
  });
}

export function readStateChanges(param?: any): CTPStateChange[] {
  var data = readFromFile(path + "//statechanges.json");

  if (!data || data.length === 0) return [] as CTPStateChange[];

  var tasks: CTPStateChange[] = JSON.parse(data, (key, value) => {
    if (key.includes("startW") || key.includes("endW"))
      return fromISOString(value);

    return value;
  });

  // Map JSON objects to CTPResource instances
  tasks = tasks.map((res: any) => {
    const resource = new CTPStateChange(
      res.resourceType,
      res.fromState,
      res.toState,
    );
    Object.assign(resource, res);

    return resource;
  });

  return tasks;
}

export function readScorings(param?: any): CTPScoring[] {
  var data = readFromFile(path + "//scorings.json");

  if (!data || data.length === 0) return [] as CTPScoring[];

  var tasks: CTPScoring[] = JSON.parse(data);

  // Map JSON objects to CTPResource instances
  tasks = tasks.map((res: any) => {
    const resource = new CTPScoring(res.name, res.key);
    Object.assign(resource, res);

    // If the resource has nested objects, map them to their respective classes
    return resource;
  });

  return tasks;
}

export function writeScorings(scorings: CTPScoring[]) {
  const jsonString = JSON.stringify(scorings);

  fs.writeFile(path + "/scorings.json", jsonString, function (err) {
    if (err) {
      return console.error(err);
    }
    console.log("File created!");
  });
}
export function readHorizon(param?: any): CTPHorizon {
  var data = readFromFile(path + "//horizon.json");
  if (!data || data.length === 0) return new CTPHorizon();

  var hor1: CTPHorizon = JSON.parse(data, (key, value) => {
    if (key.includes("startW") || key.includes("endW"))
      return fromISOString(value);
    if (key.includes("startDate") || key.includes("endDate"))
      return fromISOString(value);
    return value;
  });

  const hor = new CTPHorizon();
  Object.assign(hor, hor1);

  return hor;
}

export function writeHorizon(hor: CTPHorizon) {
  const str = JSON.stringify(hor, (key, value) => {
    if (key.includes("startW") || key.includes("endW"))
      return toISOString(value);
    if (key.includes("startDate") || key.includes("endDate"))
      return toISOString(value);
    return value;
  });

  fs.writeFile(path + "/horizon.json", str, function (err) {
    if (err) {
      return console.error(err);
    }
    console.log("File created!");
  });
}

export function writeTimeline(tl: CTPTimeline) {
  fs.writeFile(path + "/timeline.json", JSON.stringify(tl), function (err) {
    if (err) {
      return console.error(err);
    }
    console.log("File created!");
  });
}

export function writeAppSettings(settings: CTPAppSettings) {
  fs.writeFile(
    path + "/appsettings.json",
    JSON.stringify(settings),
    function (err) {
      if (err) {
        return console.error(err);
      }
      console.log("File created!");
    },
  );
}

export function readTimeline(param?: any): CTPTimeline {
  var data = readFromFile(path + "//timeline.json");

  if (!data || data.length === 0) return new CTPTimeline("");

  var hor1: CTPTimeline = JSON.parse(data);

  const hor = new CTPTimeline(hor1.name, hor1.key);
  Object.assign(hor, hor1);
  return hor;
}

export function readAppSettings(param: any): CTPAppSettings {
  var data = readFromFile(path + "//appsettings.json");
  if (!data || data.length === 0) return new CTPAppSettings();

  var hor: CTPAppSettings = JSON.parse(data);

  return hor;
}
