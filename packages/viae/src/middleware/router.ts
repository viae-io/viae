

import { Rowan, Processor, Middleware, Next, Meta, If, IRowan } from 'rowan';
import { Context } from '../context';
import { pathToRegexp } from 'path-to-regexp';
import { normalisePath } from '../util/normalise';

export interface RouterOptions {
  /** route root path */
  root?: string;
  /** route descriptive name */
  name?: string;
  /** route documentation */
  doc?: string;

  middleware?: Middleware<Context>[];
};

export class Router implements Middleware<Context>, RouterOptions {
  /** route base path  */
  root: string;
  /** route descriptive name */
  name: string;
  /** route documentation */
  doc: string;
  /** route middleware */
  middleware: Middleware<Context>[] = [];

  meta: Meta;

  private _rootMatch: (ctx: Context) => string;

  constructor(opts: RouterOptions = {}) {
    this.root = opts.root || "/";
    this.middleware = opts.middleware || [];
    this.root = normalisePath(this.root);
    this.meta = {
      type: "Router",
      path: this.root,
      doc: opts.doc,
    }

    if (this.root == "") {
      this._rootMatch = () => "";
      return;
    }

    const keys = [];
    const exp = pathToRegexp(this.root, keys, {
      strict: false,
      end: false,
    });

    this._rootMatch = (ctx) => {
      let match = (ctx.in.head.path) ? exp.exec(ctx.in.head.path) : null;
      if (match == null) {
        return;
      }
      if (keys.length > 0) {
        ctx.params = ctx.params || {};
        for (let i = 0; i < keys.length; i += 1) {
          ctx.params[keys[i].name] = match[i + 1];
        }
      }
      return match[0];
    };
  }

  process(ctx: Context, next: Next): Promise<void> {
    let match = this._rootMatch(ctx);

    if (match != undefined) {
      let originalPath = ctx.in.head.path;

      if (ctx.in.head.fullPath === undefined) {
        ctx.in.head.fullPath = originalPath;
      }

      ctx.in.head.path = normalisePath(originalPath.substr(match.length));

      return Rowan.process(this.middleware, ctx, function () {
        ctx.in.head.path = originalPath;
        return next();
      }).then(() => { ctx.in.head.path = originalPath; })
        .catch((err) => { ctx.in.head.path = originalPath; throw err; });
    }
    return next();
  }

  private use(processor: Processor<Context>, meta?: Meta) {
    this.middleware.push(Rowan.convertToMiddleware(processor, meta));
  }

  route(opts: {
    path: string,
    method: string,
    process: Processor<Context>[]
    name?: string,
    doc?: string,
    end?: boolean;
  }) {
    const path = normalisePath(opts.path);
    const keys = [];

    const exp = pathToRegexp(path, keys, {
      strict: false,
      end: (opts.end !== undefined) ? opts.end : true
    });

    const doc = opts.doc;
    const method = opts.method;
    const middleware = opts.process.map(x => Rowan.convertToMiddleware(x));

    const routeProcessor = {
      meta: { method, path: opts.path },
      middleware,
      process: function (ctx, next): Promise<void> {
        if (ctx.in == undefined || ctx.in.head == undefined)
          return next();

        if (method && ctx.in.head.method !== method)
          return next();

        let match = null;

        if (path == ctx.in.head.path) {
          match = [path];
        }
        else {
          match = (ctx.in.head.path) ? exp.exec(ctx.in.head.path) : null;
          if (match == null) {
            return next();
          }
          if (keys.length > 0) {
            ctx.params = ctx.params || {};
            for (let i = 0; i < keys.length; i += 1) {
              ctx.params[keys[i].name] = match[i + 1];
            }
          }
        }

        if (match == null) {
          return next();
        }

        let originalPath = ctx.in.head.path;
        let originalMatched = ctx.in.head.matchedPath;
        ctx.in.head.matchedPath = match[0];
        ctx.in.head.path = originalPath.substr(match[0].length);

        return Rowan.process(middleware, ctx, function () {
          ctx.in.head.path = originalPath;
          ctx.in.head.matchedPath = originalMatched;
          return next();
        }).finally(() => {
          ctx.in.head.path = originalPath;
          ctx.in.head.matchedPath = originalMatched;
        });
      }
    }

    this.use(routeProcessor);
  }
}

