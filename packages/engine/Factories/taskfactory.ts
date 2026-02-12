import {
  CTPStateChangeConstants,
  CTPTaskTypeConstants,
} from "../Models/Core/constants";
import { CTPDuration, CTPInterval } from "../Models/Core/window";
import { CTPStateChange } from "../Models/Entities/statechange";
import {
  CTPTask,
  CTPTaskResource,
  CTPTaskResourceList,
} from "../Models/Entities/task";
import { IdFactory } from "./uniqueidfactory";

export class TaskFactory {
  

  public static createTask(res: CTPTask, name: string, key: string): CTPTask {
    

    const ukey = IdFactory.generateUniqueKey();
    const resource = new CTPTask(res.type, res.name, key );

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

    resource.name = name;
    resource.key = ukey;
    resource.hashKey = resource.createhash();
    
    
    
    // If the resource has nested objects, map them to their respective classes
    return resource;
  }

  public static createStateTask(res: CTPTask, type: string, name: string, duration : number): CTPTask {
    
    const resource = TaskFactory.createTask(res, res.name, res.key);
    if (resource.capacityResources)  resource.capacityResources.clear();
    else resource.capacityResources = new CTPTaskResourceList();
    if (resource.materialsResources)  resource.materialsResources.clear();
    else resource.materialsResources = new CTPTaskResourceList();
    resource.type = type;
    resource.process = res.process;
    resource.name = name;

    resource.hashKey = resource.createhash();
    if (resource.duration) {
      resource.duration.startW = 0;
      resource.duration.endW = duration;
    }
    if (res.scheduled) {
      if (!resource.scheduled) resource.scheduled = new CTPInterval();
      resource.scheduled.startW = 0;
      resource.scheduled.endW = duration  
    }
    return resource;
  }
}
