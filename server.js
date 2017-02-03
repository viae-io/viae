const WebSocketServer = require('ws').Server;
const Viae = require('./lib/index').Viae;
const EventEmitter = require('events');

let wss = new WebSocketServer({ port: 9090, handleProtocols: ["viae"] });
let server = new Viae(wss);

server.path("/greet", (ctx) => {
  ctx.begin();
  ctx.send("w");
  ctx.send("o");
  ctx.send("r");
  ctx.send("l");
  ctx.send("d");
  ctx.end();
  return false;
});

server.use((ctx) => {
  return 404;
});

server.use((ctx, err) => {
  console.log(err);
  if (typeof (err) == "number") {
    ctx.res.status = err;
  } else {
    ctx.res.status = 504;
  }
  return ctx.send();
});

console.log("Server Running on 9090....");

setInterval(() => {
  server.broadcast({
    status:200,
    path:"/welcome",
    body:"hello"
  })
}, 2000);
