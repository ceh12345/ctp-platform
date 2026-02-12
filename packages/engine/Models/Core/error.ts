"strict";

export interface IError {
  agent: string;
  type: string;
  reason: string;
 
}

export class CTPError implements IError {
  public agent: string = '';
  public type: string  = '';
  public reason: string  = '';

  constructor()
  {

  }


}
