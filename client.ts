import * as Ws from 'ws';
import * as readline from 'readline';
import { Via } from './src/index';

let ws = new Ws("ws://127.0.0.1:9090");
let via = new Via(ws);

ws.on("open", async () => {
  via.request({ method: "PING", path: "/" }).then(x => {
    console.log("PONG!");
  });

  via.request({ method: "GET", path: "/greet" }).then((ctx) => {
    if (isPipeable(ctx.res.body)) {
      ctx.res.body.pipe(process.stdout);
      return false;
    } else {
      console.log(ctx.res.body);
    }
  });

  let result = await via.request({
    method: "GET",
    path: "/service",
    body: 10,
  });

  console.log("GET /service (" + result.res.status + ") body: " + result.res.body);
});

function isPipeable(obj) {
  return obj.pipe !== undefined && typeof (obj.pipe) == "function";
}
