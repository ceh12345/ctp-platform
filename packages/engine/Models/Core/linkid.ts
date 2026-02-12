"strict";

export interface ILinkId {
  name: string;
  type: string;
  prevLink: string;
}

export class CTPLinkId implements ILinkId {
  public name: string;
  public type: string;
  public prevLink: string;

  constructor(n?:string,t?:string,prev?:string)
  {
    this.name = n??  '';
    this.type = t ?? '';
    this.prevLink = prev??'';
  }
}
