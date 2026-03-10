import { Rowan, type Middleware, type Next, type Processor, type Meta } from "rowan";
import type { Context } from "./context.js";
import { pathToRegexp, type Key } from "path-to-regexp";
import { normalisePath } from "./normalise.js";

export interface RouterOptions {
  root?: string;
  name?: string;
  doc?: string;
  middleware?: Middleware<Context>[];
}

export class Router implements Middleware<Context>, RouterOptions {
  root: string;
  name?: string;
  doc?: string;
  middleware: Middleware<Context>[] = [];
  meta: Meta;

  private _rootMatch: (ctx: Context) => string | undefined;

  constructor(opts: RouterOptions = {}) {
    this.root = normalisePath(opts.root || "/");
    this.middleware = opts.middleware || [];
    this.meta = {
      type: "Router",
      path: this.root,
      doc: opts.doc,
    };

    if (this.root === "/") {
      this._rootMatch = () => "";
      return;
    }

    const keys: Key[] = [];
    const exp = pathToRegexp(this.root, keys, {
      strict: false,
      end: false,
    });

    this._rootMatch = (ctx: Context) => {
      const path = ctx.in.head.path;
      if (!path) return undefined;
      const match = exp.exec(path as string);
      if (!match) return undefined;

      if (keys.length > 0) {
        ctx.params = ctx.params || {};
        for (let i = 0; i < keys.length; i++) {
          ctx.params[String(keys[i].name)] = match[i + 1];
        }
      }
      return match[0];
    };
  }

  process(ctx: Context, next: Next): Promise<void> {
    if (!ctx.in.head.path) return next();
    const match = this._rootMatch(ctx);
    if (match === undefined) return next();

    const originalPath = ctx.in.head.path as string;

    if (ctx.in.head.fullPath === undefined) {
      ctx.in.head.fullPath = originalPath;
    }

    ctx.in.head.path = normalisePath(originalPath.substring(match.length));

    return Rowan.process(this.middleware, ctx, () => {
      ctx.in.head.path = originalPath;
      return next();
    }).then(() => {
      ctx.in.head.path = originalPath;
    }).catch((err) => {
      ctx.in.head.path = originalPath;
      throw err;
    });
  }

  use(processor: Processor<Context>, meta?: Meta) {
    this.middleware.push(Rowan.convertToMiddleware(processor, meta));
  }

  route(opts: {
    path: string;
    method: string | null;
    process: Processor<Context>[];
    name?: string;
    doc?: string;
    end?: boolean;
  }) {
    const path = normalisePath(opts.path);
    const keys: Key[] = [];

    const exp = pathToRegexp(path, keys, {
      strict: false,
      end: (opts.end !== undefined) ? opts.end : true,
    });

    const method = opts.method;
    const middleware = opts.process.map(x => Rowan.convertToMiddleware(x));

    const routeProcessor: Middleware<Context> & { meta: Meta } = {
      meta: { method, path: opts.path },
      process(ctx: Context, next: Next): Promise<void> {
        if (!ctx.in || !ctx.in.head) return next();
        if (method && ctx.in.head.method !== method) return next();

        let match: RegExpExecArray | null = null;

        if (path === ctx.in.head.path) {
          match = [path] as unknown as RegExpExecArray;
        } else {
          match = ctx.in.head.path ? exp.exec(ctx.in.head.path as string) : null;
          if (!match) return next();

          if (keys.length > 0) {
            ctx.params = ctx.params || {};
            for (let i = 0; i < keys.length; i++) {
              ctx.params[String(keys[i].name)] = match[i + 1];
            }
          }
        }

        const originalPath = ctx.in.head.path as string;
        const originalMatched = ctx.in.head.matchedPath;
        ctx.in.head.matchedPath = match[0];
        ctx.in.head.path = originalPath.substring(match[0].length) || "/";

        return Rowan.process(middleware, ctx, () => {
          ctx.in.head.path = originalPath;
          ctx.in.head.matchedPath = originalMatched;
          return next();
        }).finally(() => {
          ctx.in.head.path = originalPath;
          ctx.in.head.matchedPath = originalMatched;
        });
      }
    };

    this.middleware.push(routeProcessor);
  }
}
