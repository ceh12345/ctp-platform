"strict"
import { CTPScheduleDirectionConstants, CTPTaskStateConstants } from "../../../Models/Core/constants";
import { List } from "../../../Models/Core/list";
import { CTPAppSettings } from "../../../Models/Entities/appsettings";
import { SchedulingLandscape } from "../../../Models/Entities/landscape";
import { CTPProcess } from "../../../Models/Entities/process";
import { CTPTask, CTPTaskList } from "../../../Models/Entities/task";
import { AIAgent } from "../agent";

export interface IDependencyLookAhead
{
    earliestPredTaskNotScheduled(tasks: List<CTPTask>, fromSequence: number, direction: number ) : CTPTask | null
    preschedule(landscape: SchedulingLandscape, tasks: List<CTPTask>,settings: CTPAppSettings) : CTPTask[];
    postschedule(landscape: SchedulingLandscape, tasks: List<CTPTask>, task: CTPTask, settings: CTPAppSettings) : CTPTask[];
}

// Add in the earliest or latest Not Scheduled Task based on an incoming sequence number
export class DependencyLookAheadAgent extends AIAgent
{
    constructor()
    {
        super("LookAheadTiming");
    }
   
    public earliestPredTaskNotScheduled(tasks: List<CTPTask>, fromSequence: number, direction: number ) : CTPTask | null
    {
        let found : CTPTask | null = null;
        if (direction == CTPScheduleDirectionConstants.BACKWARD)
        {
            for (let i = tasks.length-1; i>=0;i--)
            {
                const t = tasks.index(i);
                if (t && t.state == CTPTaskStateConstants.NOT_SCHEDULED && !t.processed && t.sequence > fromSequence)
                {
                    found = t;
                    break;
                }
            }
        }
        else {
            for (let i = 0; i < tasks.length;i++)
            {
                const t = tasks.index(i);
                if (t && t.state == CTPTaskStateConstants.NOT_SCHEDULED && !t.processed && t.sequence < fromSequence)
                {
                    found = t;
                    break;
                }
            }
        }
       
        return found;
    }
    // Auto add in any task dependecies based on current tasks
    public preschedule(landscape: SchedulingLandscape, tasks: List<CTPTask>,settings: CTPAppSettings) : CTPTask[]
    {
        let newList: CTPTask[] = [];
        let processed : any[] = [];
        
        // Determine which tasks belong to a process and mark the max / min sequence
        tasks.forEach(t=> { 
            if (t.hasLinkId() && t.linkId?.name)
            {
                const found = processed.find(p=>p.name == t.linkId?.name);
                if (!found) processed.push({name:t.linkId?.name, sequence: t.sequence });
                else {
                    if (settings.scheduleDirection == CTPScheduleDirectionConstants.BACKWARD)
                    {
                        if (t.sequence < found.sequence ) found.sequence = t.sequence;
                    }
                    else {
                        if (t.sequence > found.sequence ) found.sequence = t.sequence;
                    }
                }
            }
        });

        processed.forEach(p=> { 
            const process = landscape.processes.getEntity(p.name);
            if (process && process.tasks)
            {
                process.tasks.forEach(t=>{
                    if (settings.scheduleDirection == CTPScheduleDirectionConstants.BACKWARD)
                    {
                        if ((t.sequence > p.sequence) && !tasks.includes(t)) newList.push(t);
                    }
                    else {
                        if ((t.sequence < p.sequence) && !tasks.includes(t)) newList.push(t);
                    }
                });
            }
        });    
        if (newList.length > 0)
            newList.forEach(t=>{tasks.add(t)});
        return newList;
    }

    public postschedule(landscape: SchedulingLandscape, tasks: List<CTPTask>, task: CTPTask, settings: CTPAppSettings) : CTPTask[]
    {
        let newTasks : CTPTask[] = [];
        /*
        if (task.hasLinkId() && task.linkId?.name && task.state === CTPTaskStateConstants.SCHEDULED )
        {
            const process = landscape.processes.getEntity(task.linkId.name);
            if (process && process.tasks)
            {
                const found = this.getFirstPredTaskNotScheduled(process.tasks, task.sequence, settings.scheduleDirection);
                if (found && !tasks.contains(found)) 
                    tasks.push(found);
            }
        }
        else if (task.hasLinkId() && task.linkId?.name && task.state === CTPTaskStateConstants.NOT_SCHEDULED && task.process)
        {
        */
       // Set all other tasks not processed yet to processed with an error 
        if (task.processed && task.hasLinkId() && task.linkId?.name && task.state === CTPTaskStateConstants.NOT_SCHEDULED)
        {
            tasks.forEach(t => {
               if (t.hasLinkId() && (t.linkId?.name === task.linkId?.name) && (t.key != task.key) && !t.processed)
               {
                 t.processed = true;
                 if (t.state === CTPTaskStateConstants.NOT_SCHEDULED) 
                    t.addError(this.name, "Predecessor not met")
               }
                   
            });
        }  
        return newTasks;
    }
}