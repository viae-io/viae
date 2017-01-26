
import { Rowan, IRowan, Handler } from 'rowan';
import { ViaContext } from './context';

export type ViaPath = string | RegExp | (string | RegExp)[];
export type ViaHandler = Handler<ViaContext>;
export type ViaInterceptor = { dispose: () => void, handlers: ViaHandler[] };
