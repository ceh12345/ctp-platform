import { CTPInterval } from "../Models/Core/window";
import { CTPDateTime } from "../Models/Core/date";

export function testWindows(): number {
  var w = new CTPInterval(0, 10, 10);

  console.log("Window " + w.duration().toString());

  let n = CTPDateTime.fromDateTime(CTPDateTime.now());
  var e: number = w.endW;

  let d = CTPDateTime.toDateTime(w.endW);
  let s = d.toISO();
  console.log(s);
  console.log("Done ");
  return 0;
}
