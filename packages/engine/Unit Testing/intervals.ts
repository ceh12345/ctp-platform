import { CTPInterval } from "../Models/Core/window";
import * as CTPLists from "../Models/Core/linklist";
import { CTPIntervals } from "../Models/Intervals/intervals";
import { CTPDateTime } from "../Models/Core/date";
import { CTPSetEngine } from "../Engines/setengine";

export function testProfiles(): number {
  var list = new CTPIntervals();
  var listB = new CTPIntervals();
  var c1: CTPInterval;

  var d1 = CTPDateTime.fromDateTime(CTPDateTime.now());

  for (let i = 1; i < 10; i++) {
    c1 = new CTPInterval(d1, d1 + CTPDateTime.ONE_DAY, i * 10);

    d1 += CTPDateTime.ONE_DAY;

    list.add(c1);
  }

  let i = list.head;
  let c = 0;

  while (i) {
    c += 1;
    console.log(
      i.data.AbsoluteStartTime.toFormat("LLL dd yyyy HH:mm ") +
        " - " +
        i.data.AbsoluteEndTime.toFormat("LLL dd yyyy HH:mm"),
    );
    i = i.next;
  }

  i = list.atOrAfterStartTime(0, 4);

  if (i) console.log(i.data.endW);

  c = 0;

  while (list.head) {
    let i = list.tail;
    console.log("Deleting " + i?.data.endW);
    c += 1;
    list.deleteNode(i);
  }

  console.log("Done " + list.size().toString());

  return 0;
}
