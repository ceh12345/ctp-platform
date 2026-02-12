import { List } from "../Models/Core/list";
import {
  CTPResource,
  CTPResourcePreference,
  CTPResources,
} from "../Models/Entities/resource";

class BaseX {
  radix: number;
  value: number;
  constructor(initRadix: number) {
    this.radix = initRadix ? initRadix : 1;
    this.value = 0;
  }
  public increment(): boolean {
    return (this.value = (this.value + 1) % this.radix) === 0;
  }
}

export class CombinationEngine {
  constructor() {}

  public combinations(input: any[]): any[] {
    var output = [], // Array containing the resulting combinations
      counters = [], // Array of counters corresponding to our input arrays
      remainder = false, // Did adding one cause the previous digit to rollover?
      temp; // Holds one combination to be pushed into the output array

    // Initialize the counters
    for (var i = input.length - 1; i >= 0; i--) {
      counters.unshift(new BaseX(input[i].length));
    }

    // Get all possible combinations
    // Loop through until the first counter rolls over
    while (!remainder) {
      temp = []; // Reset the temporary value collection array
      remainder = true; // Always increment the last array counter

      // Process each of the arrays
      for (i = input.length - 1; i >= 0; i--) {
        temp.unshift(input[i][counters[i].value]); // Add this array's value to the result

        // If the counter to the right rolled over, increment this one.
        if (remainder) {
          remainder = counters[i].increment();
        }
      }
      output.push(temp); // Collect the results.
    }

    return output;
  }
}

export class ResourceCombinationEngine extends CombinationEngine {
  public resourcecombinations(
    input: CTPResourcePreference[],
    uniqueness: boolean = true,
  ): CTPResourcePreference[][] {
    let intermediate: CTPResourcePreference[][] = this.combinations(input);
    if (!intermediate || !uniqueness) return intermediate;

    let results: CTPResourcePreference[][] = [];
    intermediate.forEach((combo) => {
      let add = true;
      let str = "";
      for (let i = 0; i < combo.length; i++) {
        // check for uniqueness
        if (str.includes(combo[i].resourceKey)) {
          add = false;
          break;
        }
        str = str + combo[i].resourceKey + ",";
      }
      if (add) results.push(combo);
    });
    return results;
  }
}
/*
const charSet = [["A", "B"],["C", "D", "E"],["F", "G", "H", "I"]];

let loopOver = (arr : any, str = '') => arr[0].map((v: string) => arr.length > 1 ? loopOver(arr.slice(1), str + v) : str + v).flat();

const result = loopOver(charSet);
console.log(result);
*/
