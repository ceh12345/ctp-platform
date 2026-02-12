import { CTPDuration, CTPInterval } from "../Models/Core/window";
import { CTPResource } from "../Models/Entities/resource";
import { AvailableMatrix } from "../Models/Intervals/availablematrix";
import { CTPAssignments, CTPAvailable } from "../Models/Intervals/intervals";
import { IdFactory } from "./uniqueidfactory";

export class ResourceFactory {
  public static createResource(res: CTPResource): CTPResource {
    const resource = new CTPResource();
    Object.assign(resource, res);

    // If the resource has nested objects, map them to their respective classes
    if (res.original) {
      resource.original = new CTPAvailable();
      res.original.toArray().forEach((r: any) => {
        const taskResource = new CTPInterval();
        Object.assign(taskResource, r);
        resource.original?.add(taskResource);
      });
    }

    if (res.assignments) {
      resource.assignments = new CTPAssignments();
      res.assignments.toArray().forEach((r: any) => {
        const taskResource = new CTPInterval();
        Object.assign(taskResource, r);
        resource.assignments?.add(taskResource);
      });
    }

    resource.available = new AvailableMatrix();
    
    resource.key = IdFactory.generateUniqueKey();
    resource.hashKey = resource.createhash();

    return resource;
  }
}
