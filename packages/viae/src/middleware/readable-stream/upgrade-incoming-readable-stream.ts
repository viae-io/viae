
import { Context, ResponseContext } from '../../context';
import { Middleware } from "rowan";
import { EventBus } from './event-bus';

export class UpgradeIncomingReadableStream implements Middleware<Context> {
  meta: {
    type: "IncomingReadableStream"
  }
  process(ctx: Context, next: () => Promise<void>) {
    if (!ctx.in || !ctx.in.head || typeof ctx.in.head["readable"] !== "string") {
      return next();
    }

    const bus = new EventBus();
    const sid = ctx.in.head["readable"] as string;
    const connection = ctx.connection;
    let dispose;

    ctx.in.data = new ReadableStream({
      async cancel() {
        if (dispose) {
          connection.send({ id: sid, head: { method: "ABORT" } });
          dispose();
          dispose = null;
        }
      },
      async start(controller) {
        dispose = connection.intercept(sid, [
          async (ctx: ResponseContext) => {
            let res = ctx.in;
            let status = res.head.status;
            let data = res.data;
            if (status == 206) {
              controller.enqueue(data);
              if (controller.desiredSize == 0) {
                bus.emit("pause");
                await connection.send({ id: sid, head: { method: "THROTTLE" } });
              }
            } else if (status == 500) {
              controller.error(res.data);
              dispose();              
            } else {
              controller.close();
              dispose();   
            }
          }])
          
        //we're ready to capture incoming messages       

        await connection.send({ id: sid, head: { method: "START" } });
      },
      async pull(){
        console.log("pull");
        await connection.send({ id: sid, head: { method: "PULL" } });
        await bus.wait("pause");
      }
    }, { highWaterMark: 128 });

    return next();
  }
}