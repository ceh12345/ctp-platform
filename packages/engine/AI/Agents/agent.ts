export interface IAIAgent {
  name: string;
}

export class AIAgent implements IAIAgent {
  public name: string;

  constructor(n?: string) {
    this.name = "";
    if (n) this.name = n;
  }
}
