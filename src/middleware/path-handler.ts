import * as pathToRegexp from 'path-to-regexp';
import { ViaContext } from '../via';

export type ViaPath = string | RegExp | (string | RegExp)[];

export function pathHandler(path: ViaPath) {
  let keys = [];
  var exp = pathToRegexp(path, keys);
  return (ctx: ViaContext) => {
    let match = (ctx.req.path) ? exp.exec(ctx.req.path) : null;
    if (match == null) {
      return false;
    }
    if (keys.length > 0) {
      ctx.req.params = ctx.req.params || {};
      for (let i = 0; i < keys.length; i += 1) {
        ctx.req.params[keys[i].name] = match[i + 1];
      }
    }
  };
}