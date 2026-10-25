import type {Logger} from 'pino';
export function createBrowserLogger(write?:(line:Record<string,unknown>)=>void):Logger;
export function recordSessionCheckUnavailable(
  identity:{userId?:string;companyId?:string|null},
  target?:Logger,
  fields?:{code?:string;stage?:string;correlation?:unknown},
):void;
export function recordPreparationValidationRejected(identity:{userId?:string;companyId?:string|null},target?:Logger):void;
export function recordLogoutTransportFailed(identity:{userId?:string;companyId?:string|null},error:unknown,target?:Logger):void;
