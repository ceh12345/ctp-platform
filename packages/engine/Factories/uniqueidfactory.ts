export class IdFactory {
  public static counter = 0;

  public static generateUniqueKey(): string {

    this. counter = this.counter + 1;
    const dateStr = Date
    .now()
    .toString(36); // convert num to base 36 and stringify

  const randomStr = Math
    .random()
    .toString(36)
    .substring(2, 8); // start at index 2 to skip decimal point

  return `${dateStr}-${randomStr}${this.counter.toString()}`;
  }
}