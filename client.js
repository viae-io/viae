const WebSocket = require('ws');
const readline = require('readline');
const EventEmitter = require('events');
const Via = require('./lib/index.js').Via;

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });

let ws = new WebSocket("ws://localhost:9090", "viae");
let via = new Via(ws);

via.use((ctx) => {
  if (isPipeable(ctx.res.body)) {
    ctx.res.body.pipe(process.stdout, { end: false });
    return false;
  } else {
    console.log(ctx.res.body);
  }
});

rl.on("line", (line) => {
  via.request({ path: "/greet", body: line });
});

function isPipeable(object) {
  return object.pipe !== undefined && typeof (object.pipe) == "function";
}

setInterval(() => {

  via.request({ method: 0 }).then(x => {
    console.log("PONG!");
  });
}, 3000);