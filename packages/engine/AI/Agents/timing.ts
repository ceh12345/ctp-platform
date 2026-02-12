import { CTPScheduleDirectionConstants, CTPTaskStateConstants } from "../../Models/Core/constants";
import { CTPAppSettings } from "../../Models/Entities/appsettings";
import { SchedulingLandscape } from "../../Models/Entities/landscape";
import { CTPProcess } from "../../Models/Entities/process";
import { ScheduleContext, ScheduleContexts } from "../../Models/Entities/schedulecontext";
import { CTPTask } from "../../Models/Entities/task";

export interface ITimingSequenceAgent {
  name: string;

  solve(
    landscape: SchedulingLandscape,
    task: CTPTask,
    scheduleContexts: ScheduleContexts,
    settings: CTPAppSettings
  ): void;
}

export class TimingSequenceAgent implements ITimingSequenceAgent {
  public name: string;

  constructor(n?: string) {
    this.name = "";
    if (n) this.name = n;
  }

   // for each task in the process
  // if Not Scheduled and task is after a forward scheduling or before a backward scheduling 
  // truncate all schedules for the task
  protected truncateSchedulesForProcess(task: CTPTask,
    process: CTPProcess,
    scheduleContexts: ScheduleContexts,
    settings: CTPAppSettings)
  {
    if (process && process.tasks)
    {
      process.tasks.forEach(t => {
        if ( 
          (t.key != task.key) 
          && (t.state === CTPTaskStateConstants.NOT_SCHEDULED)
          && !t.processed
          && (
            (settings.scheduleDirection == CTPScheduleDirectionConstants.FORWARD  && t.sequence >= task.sequence ) 
            || (settings.scheduleDirection == CTPScheduleDirectionConstants.BACKWARD  && t.sequence <= task.sequence)
           )
          )
          {
              const schedules = scheduleContexts.byTask.getEntity(t.key);
              if (schedules)
              {
                  for (let i = 0; i < schedules.contexts.length; i++) {
                  const schedule = schedules.contexts.at(i);
                  if (task.scheduled && schedule &&  schedule.slot.hasStartTimes())
                  {
                      if (settings.scheduleDirection == CTPScheduleDirectionConstants.FORWARD )
                        schedule.slot.startTimes?.truncate(task.scheduled.startW,true);
                      else
                        schedule.slot.startTimes?.truncate(task.scheduled.endW,false);
                  }
                }
              }
          }
      });
    }
  }

  public solve(
    landscape: SchedulingLandscape,
    task: CTPTask,
    scheduleContexts: ScheduleContexts,
    settings: CTPAppSettings | null
  )
  {
    if (!task.hasLinkId() ) return;
    if (task.state !== CTPTaskStateConstants.SCHEDULED) return;
    if (!scheduleContexts) return;
    if (!landscape.processes) return ;
    if (!task.linkId?.name) return;
    if (!settings) return;
    
    const process = landscape.processes.getEntity(task.linkId?.name); // Find task by linkId
    if (process && process.tasks)
      this.truncateSchedulesForProcess(task,process,scheduleContexts,settings);
  }

 
}