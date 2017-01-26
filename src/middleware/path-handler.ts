import * as pathToRegexp from 'path-to-regexp';
import { ViaPath } from '../via-types';
import { ViaContext } from '../context';

export function pathHandler(path: ViaPath) {
  let keys = [];
  var exp = pathToRegexp(path, keys);
  return async (ctx: ViaContext) => {
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