"strict";
import { CTPKeyEntity } from "../Core/entity";
import { CTPProcessList } from "../Entities/process";

export class CTPRouting extends CTPKeyEntity {
  processes: CTPProcessList | undefined;
}
