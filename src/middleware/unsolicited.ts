import { ViaContext } from '../via';

/* the message is an unsolicited (broadcast) response*/
export function unsolicited() {
  return (ctx: ViaContext) => {
    return ctx.req == undefined && ctx.res != undefined && ctx.res.method == undefined;
  };
}