import * as constants from "../Models/Core/constants";
import { CTPResource, CTPResources } from "../Models/Entities/resource";
import { CombinationEngine } from "../Engines/combinationengine";

export function testCombos(): number {
  //assing.debug(true);

  const res1 = new CTPResource(
    constants.CTPResourceConstants.REUSABLE,
    "Resource",
    "Resource One",
    "1",
  );
  const res2 = new CTPResource(
    constants.CTPResourceConstants.REUSABLE,
    "Resource",
    "Resource Two",
    "2",
  );
  const res3 = new CTPResource(
    constants.CTPResourceConstants.REUSABLE,
    "Resource",
    "Resource Three",
    "3",
  );

  const charSet = [
    ["A", "B"],
    ["C", "D", "E"],
    ["F", "G", "H", "I"],
  ];

  let loopOver = (arr: any, str = "") =>
    arr[0]
      .map((v: string) =>
        arr.length > 1 ? loopOver(arr.slice(1), str + v) : str + v,
      )
      .flat();

  const result = loopOver(charSet);
  console.log(result);

  const comboEngine = new CombinationEngine();

  const combos = comboEngine.combinations([
    [0, 1],
    [0, 1, 2, 3],
    [0, 1, 2],
  ]);

  console.log(combos);

  const resourceArr: CTPResource[][] = [];
  // Number of Resources requirements
  resourceArr.push([]);
  resourceArr.push([]);
  resourceArr.push([]);

  // Number of eligible resources per requirement
  resourceArr[0].push(res1);
  resourceArr[0].push(res2);
  resourceArr[1].push(res1);
  resourceArr[1].push(res2);
  resourceArr[2].push(res2);

  const resourecombos = comboEngine.combinations(resourceArr);
  console.log(resourecombos.length);

  console.log("Done ");
  return 0;
}
