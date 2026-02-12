import { CTPInterval } from "../Models/Core/window";
import * as CTPLists from "../Models/Core/linklist";

export function testLists(): number {
  var list = new CTPLists.LinkedList<CTPInterval>();
  for (let i = 1; i < 10; i++) {
    list.insertAtBegin(new CTPInterval(0, i));
  }
  let i = list.head;
  let c = 0;

  while (i) {
    c += 1;
    console.log(i.data.endW);
    i = i.next;
  }

  let a = list.toArray();
  for (let i = 0; i < a.length; i++) {
    console.log(a[i].endW);
  }

  c = 0;

  while (list.head) {
    let i = list.tail;
    console.log("Deleting " + i?.data.endW);
    c += 1;
    list.deleteNode(i);
  }
  a = list.toArray();
  console.log("Final List Size " + a.length);

  console.log("Done ");
  return 0;
}
