import { Wire } from './wire';
import { ViaMessage, ViaMessageStreamFlags } from './message';
import { ViaContext } from './context';
import { ViaStatus } from './status';

export default function contextFactory(
  $send: (msg: ViaMessage, wire: Wire[]) => void = function () { },
  $genId: () => string = ViaMessage.genIdString,
  $noOp = function () { }
) {

  return function (wire: Wire, msg: ViaMessage): ViaContext {
    let ctx: Partial<ViaContext> = {
      wire: wire
    };

    if (msg.status != undefined) {
      ctx.res = msg;
      return <ViaContext>ctx;
    }

    ctx.req = msg;
    ctx.res = { id: msg.id };

    ctx.end = $noOp;
    ctx.begin = () => {
      let sid = $genId();
      ctx.res.status = 200;
      ctx.res.flags = ViaMessageStreamFlags.Begin;
      ctx.res.body = sid;

      $send(ctx.res, [wire]);

      ctx.res = {
        id: sid,
        status: 200,
        flags: ViaMessageStreamFlags.Next
      };

      ctx.send = (body) => {
        ctx.res.body = body || ctx.res.body;
        $send(ctx.res, [wire]);
        delete ctx.res.body;
      };

      ctx.sendStatus = $noOp;

      ctx.end = (body?) => {
        ctx.res.flags = ViaMessageStreamFlags.End;
        ctx.res.body = body || ctx.res.body;

        $send(ctx.res, [wire]);
        ctx.$done = true;

        ctx.send = $noOp;
        ctx.end = $noOp;
      };
      ctx.begin = $noOp;
    };

    ctx.send = (body: any, isDone = true) => {
      ctx.res.body = body || ctx.res.body;
      ctx.res.status = ctx.res.status || 200;
      $send(ctx.res, [wire]);
      if (isDone) {
        ctx.$done = true;

        ctx.send = $noOp;
        ctx.sendStatus = $noOp;
      }
      return !isDone;
    };

    ctx.sendStatus = (code: ViaStatus, body?: any) => {
      ctx.res.body = body || ctx.res.body;
      ctx.res.status = code;
      $send(ctx.res, [wire]);
      ctx.$done = true;
      ctx.send = $noOp;
      ctx.sendStatus = $noOp;
      return false;
    };

    return <ViaContext>ctx;
  };
}