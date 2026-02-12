import { CTPAttribute } from "../Models/Core/namevalue";
import { CTPAttributes } from "../Models/Lists/lists";
import { CTPResource, CTPResources } from "../Models/Entities/resource";
import { CTPKeyEntity } from "..//Models/Core/entity";
import * as engineTesting from "../Unit Testing/availablengine";
import * as constants from "../Models/Core/constants";
import { CTPResourceSlot } from "../Models/Entities/slot";
import { CTPDuration } from "../Models/Core/window";

export function testResources(): number {
  const resources = new CTPResources();
  for (let i = 0; i < 2000; i++) {
    const res = new CTPResource(
      constants.CTPResourceConstants.REUSABLE,
      "Resource",
      "Resource" + i.toString(),
      i.toString(),
    );
    resources.addEntity(res);
  }
  let count = 0;
  for (let c = 0; c <= 1000; c++) {
    count += resources.size();

    for (let i = 0; i < resources.size(); i++) {
      const res = resources.getEntity(i.toString());
      if (res) {
      }
    }
  }
  const res = resources.getEntity("0");
  let d = new CTPDuration(
    3600 * 3.9,
    3,
    constants.CTPDurationConstants.FIXED_DURATION,
  );
  if (res) {
    const resourceSlot = new CTPResourceSlot(res, 0);
  }

  console.log(" getting  " + count.toString());
  return 0;
}
