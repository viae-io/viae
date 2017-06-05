import * as pathToRegexp from 'path-to-regexp';
import { RequestContext } from '../context';

export type PathRequest = string | RegExp | (string | RegExp)[];

/* the message is a request with a path matching the parameter */
export function requestPath(path: PathRequest) {
  let keys = [];
  var exp = pathToRegexp(path, keys);
  return (ctx: RequestContext) => {
    let match = (ctx.req.path) ? exp.exec(ctx.req.path) : null;
    if (match == null) {
      return false;
    }
    if (keys.length > 0) {
      ctx.params = ctx.params || {};
      for (let i = 0; i < keys.length; i += 1) {
        ctx.params[keys[i].name] = match[i + 1];
      }
    }
  };
}