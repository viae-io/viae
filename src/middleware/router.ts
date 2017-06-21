import { Rowan } from 'rowan';
import { Context, ContextHandler } from '../context';
import { Method } from '../method';
import { request, requestPath, requestMethod } from '../middleware';

export class Router extends Rowan<Context> implements RouterOptions {
  /** route root path (not currently used) */
  root: string;
  /** route descriptive name */
  name: string;
  /** route documentation */
  doc: string;

  constructor(opts?: RouterOptions) {
    super();
    Object.assign(this, opts);
  }
  route(opts: {
    path: string,
    method: Method,
    handlers: ContextHandler[]
    name?: string,
    doc?: string
  }) {
    this.use(
      request(),
      requestMethod(opts.method),
      requestPath(opts.path),
      ...opts.handlers);
  }
}

export interface RouterOptions {
  /** route root path (not currently used) */
  root?: string;
  /** route descriptive name */
  name?: string;
  /** route documentation */
  doc?: string;
};