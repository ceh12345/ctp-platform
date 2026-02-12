import { LinkedList } from "../Core/linklist";
import { CTPInterval } from "../Core/window";
import { CTPStateChange, CTPStateChangeResource } from "./statechange";
import { CTPTask } from "./task";

export class CTPStartTime {
  public eStartW: number = 0;
  public eEndW: number = 0;
  public lStartW: number = 0;
  public lEndW: number = 0;
  public duration: number = 0;
  public states: CTPStateChangeResource[];
  public processChangeDuration: number = 0;
  
  constructor(
    est?: number,
    eet?: number,
    lst?: number,
    lett?: number,
    d?: number,
    state?: CTPStateChangeResource[],
  ) {
    this.eStartW = est ?? 0;
    this.eEndW = eet ?? 0;
    this.lStartW = lst ?? 0;
    this.lEndW = lett ?? 0;
    this.duration = d?? 0;
    this.states = state ?? [];
  }

  public requiresProcessChange() : boolean {
    return this.processChangeDuration > 0;
  }

  public stillFeasible() : boolean {
    return (this.lStartW - this.eStartW) > this.processChangeDuration;
  }

  public debug(showdates: boolean = true) {
    let i = new CTPInterval();
    i.startW = this.eStartW;
    i.endW = this.lStartW;
    i.qty = this.processChangeDuration
    i.debug(showdates);
  }

  public truncate(fromThisTime:number, before: boolean = true) : boolean
  {
      let rc:boolean = false;
      // If the time is before or after the startTime exit early

      if (fromThisTime < this.eStartW) return false;
      if (fromThisTime > this.lEndW) return false;

      if (before) // Truncate forward adjsut start times
      {
          if ((fromThisTime >= this.eStartW) && (fromThisTime <= this.eEndW))
          {
            this.eStartW = fromThisTime;
          }
          else if ((fromThisTime >= this.lStartW) && (fromThisTime <= this.lEndW))
          {
            this.lStartW = fromThisTime;
          }
      }
      else // Truncate backward adjsut end times
      {
        if ((fromThisTime >= this.eStartW) && (fromThisTime <= this.eEndW))
        {
          this.eEndW = fromThisTime;
        }
        else if ((fromThisTime >= this.lStartW) && (fromThisTime <= this.lEndW))
        {
           this.lEndW = fromThisTime;
        }
      }

      let truncateE = (this.eEndW - this.eStartW) < this.duration;
      let truncateL = (this.lEndW - this.lStartW) < this.duration;

      if (truncateE && truncateL) return true;
      else if (truncateE)
      {
          this.eStartW = this.lStartW;
          this.eEndW = this.lEndW
      } 
      else {
          this.lStartW = this.eStartW;
          this.lEndW = this.eEndW
      }
      
      return rc;

  }
}

export class CTPStartTimes extends LinkedList<CTPStartTime> {
  
  public constructor() {
    super();
  }

  public debug(name : string, showdates: boolean = true) {
    
    let ws = (this.whiteSpace() /3600.0) + " hours";  

    console.log(" Start Times for " + name + " WS - " + ws);
    let i = this.head;
    // while (i) {
    //   i.data.debug(showdates);
    //   i = i.next;
    // }
    console.log(" End Start Times ");
    console.log(" ");
  }
  public whiteSpace(): number {
    let i = this.head;
    let w = 0;
    while (i) {
      w += (i.data.lStartW - i.data.eStartW);
      i = i.next;
    }
    return w;
  }
  public changeOver(): number {
    let i = this.head;
    let w = 0;
    while (i) {
      w += i.data.processChangeDuration;
      i = i.next;
    }
    return w;
  }
 
  public truncate(fromThisTime: number, before:boolean = true)
  {
    let i = this.head;
    
    while (i) {
      if (i.data.truncate( fromThisTime, before ))
      {
        const node = i;
        i = i.next;
        this.deleteNode(node)
      }
      else
        i = i.next;
    }
    
  }
}

