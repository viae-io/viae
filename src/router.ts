import { Rowan } from 'rowan';
import { ViaHandler } from './via';
import { ViaContext } from './context';
import { request, requestPath, requestMethod } from './middleware';

export class Router extends Rowan<ViaContext>{
  route(opts: {
    path: string,
    method: string,
    handlers: ViaHandler[]
  }) {
    this.use(
      request(),
      requestMethod(opts.method),
      requestPath(opts.path),
      ...opts.handlers);
  }
}