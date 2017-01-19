
import { Rowan, IRowan, Handler } from 'rowan';
import { Context } from './context';

export type ViaPath = string | RegExp | (string | RegExp)[];
export type ViaHandler = Handler<Context>;
export type ViaInterceptor = { dispose: () => void, handlers: ViaHandler[] };
