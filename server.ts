import { Server } from 'ws';
import { Viae, ViaContext, Wire } from './src/index';

let wss = new Server({ port: 9090 });
let server = new Viae(wss);

server.route({
  method: "GET",
  path: "/greet",
  handlers: [
    (ctx) => {
      ctx.begin();
      ctx.send("hello ");
      ctx.send("w");
      ctx.send("o");
      ctx.send("r");
      ctx.send("l");
      ctx.send("d");
      ctx.send("\n");
      ctx.end();
      return false;
    }]
});

server.route({
  method: "PING",
  path: "/",
  handlers: [(ctx: ViaContext) => ctx.sendStatus(200)]
});

var service: Wire;

server.route({
  method: "REGISTER",
  path: "/service",
  handlers: [
    (ctx: ViaContext) => {
      console.log("registered");
      service = ctx.wire;
      var dispose = () => service = undefined;
      ctx.wire.on("close", () => dispose());

      return ctx.sendStatus(200);
    }]
});

server.route({
  method: "GET",
  path: "/service",
  handlers: [
    async (ctx: ViaContext) => {
      if (service == undefined) { return ctx.sendStatus(404); }

      let result = await server.request({
        method: "GET",
        path: "/service",
        body: ctx.req.body
      }, false, service);

      console.log(result);

      return ctx.sendStatus(result.res.status, result.res.body);
    }]
});


server.use((ctx) => {
  return 404;
});

server.use((ctx, err) => {
  if (typeof (err) == "number") {
    ctx.res.status = err;
  } else {
    console.log(err);
    ctx.res.body = err;
    ctx.res.status = 504;
  }
  return ctx.send();
});

server.before((ctx: ViaContext) => {
  ctx["_start"] = process.hrtime();
});

server.after((_) => (_.req) ? undefined : false, (ctx: ViaContext) => {
  let start = ctx["_start"];
  let hrspan = process.hrtime(start);
  let span = hrspan[0] * 1000 + hrspan[1] / 1000000;

  console.log(`${ctx.req.method} ${ctx.req.path} - ${ctx.res.status} (${span}ms)`);
});

console.log("Server Running on 9090....");