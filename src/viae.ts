import { Context, ContextProcessor, ContextHandler } from './context';
import { Wire, WireServer } from './wire';
import { Via } from './via';
import { Method } from './method';
import { Message } from './message';
import { Rowan } from 'rowan';
import { LiteEventEmitter } from 'lite-event-emitter';

import { Interceptor } from './middleware';
import { request, requestMethod, requestPath } from './middleware';

import { ViaePlugin, isPlugin } from './viae-plugin';

export class Viae implements ContextProcessor {
  private _connections = new Array<Via>();

  private _interceptor = new Interceptor();
  private _before = new Rowan<Context>();
  private _after = new Rowan<Context>();
  private _app = new Rowan<Context>([this._interceptor, this._before]);

  private _events = new LiteEventEmitter();

  constructor(server: WireServer, ...plugins: ViaePlugin[]) {
    server.on("connection", (wire: Wire) => {
      let via = new Via(wire);

      via.use(this);

      wire.on("close", () => {
        this._connections.splice(this._connections.indexOf(via), 1);
      });

      this._connections.push(via);

      this._events.emit("connection", via);
    });

    for (let extension of plugins) {
      extension.plugin(this);
    }
  }

  get connections() { return this._connections; };

  on(event: "connection", cb: (connection: Via) => void) {
    this._events.on(event, cb);
  }

  async process(ctx: Context, error?: Error) {
    try {
      await this._app.process(ctx, error);
    } catch (err) {
      error = err;
    }
    delete ctx.$done;
    await this._after.process(ctx, error);
  }

  before(handler: ContextHandler, ...handlers: ContextHandler[]) {
    this._before.use(handler, ...handlers);
  }
  use(plugin: ViaePlugin)
  use(handler: ContextHandler, ...handlers: ContextHandler[])
  use(handler: ContextHandler | ViaePlugin, ...handlers: ContextHandler[]) {
    if (isPlugin(handler)) {
      handler.plugin(this);
    } else {
      this._app.use(handler, ...handlers);
    }
  }
  after(handler: ContextHandler, ...handlers: ContextHandler[]) {
    this._after.use(handler, ...handlers);
  }
}