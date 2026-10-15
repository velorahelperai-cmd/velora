import type {Logger} from 'pino';
export function createBrowserLogger(write?:(line:Record<string,unknown>)=>void):Logger;
export function recordSessionCheckUnavailable(identity:{userId?:string;companyId?:string|null},target?:Logger):void;
