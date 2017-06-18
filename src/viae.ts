import { Context, ContextProcessor, ContextHandler } from './context';
import { Wire, WireServer } from './wire';
import { Via } from './via';
import { Method } from './method';
import { Message } from './message'; 
import { Rowan } from 'rowan';

import { Interceptor } from './middleware';
import { request, requestMethod, requestPath } from './middleware';

export class Viae implements ContextProcessor {
  private _connections = new Array<Via>();

  private _interceptor = new Interceptor();
  private _before = new Rowan<Context>();
  private _after = new Rowan<Context>();
  private _app = new Rowan<Context>([this._interceptor, this._before]);

  constructor(server: WireServer) {
    server.on("connection", (wire: Wire) => {
      let via = new Via(wire);

      via.use(this);

      wire.on("close", () => {
        this._connections.splice(this._connections.indexOf(via), 1);
        console.log("Client Disconnected");
      });

      this._connections.push(via);
      console.log("Client Connected");
    });
  }

  get connections() { return this._connections; };

  async process(ctx: Context, error?: Error) {
    try {
      await this._app.process(ctx, error);
    } catch (err) {
      error = err;
    }

    console.log("done app");

    delete ctx.$done;

    await this._after.process(ctx, error);
  }

  before(handler: ContextHandler, ...handlers: ContextHandler[]) {
    this._before.use(handler, ...handlers);
  }
  use(handler: ContextHandler, ...handlers: ContextHandler[]) {
    this._app.use(handler, ...handlers);
  }
  after(handler: ContextHandler, ...handlers: ContextHandler[]) {
    this._after.use(handler, ...handlers);
  }

  route(opts: {
    path: string,
    method: Method,
    handlers: ContextHandler[]
  }) {
    this.use(
      request(),
      requestMethod(opts.method),
      requestPath(opts.path),
      ...opts.handlers);
  }
}