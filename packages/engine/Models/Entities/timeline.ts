import { CTPKeyEntity, IKeyEntity } from "../Core/entity";

export interface ITimelineDTO extends IKeyEntity {}

export class CTPTimeline extends CTPKeyEntity implements ITimelineDTO {
  constructor(n: string, k?: string) {
    super("TIMELINE", n, k);
  }
}
