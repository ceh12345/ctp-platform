import { List } from "../../Models/Core/list";
import { CTPTask } from "../../Models/Entities/task";
import { CTPAppSettings } from "../../Models/Entities/appsettings";
import { SchedulingLandscape } from "../../Models/Entities/landscape";

export interface INeighborhoodStrategy {
  name: string;
  chainCompatible: boolean;
  solve(
    tasks: List<CTPTask>,
    numToProcess: number,
    settings: CTPAppSettings | null,
    landscape: SchedulingLandscape | null
  ): List<CTPTask>;
}
