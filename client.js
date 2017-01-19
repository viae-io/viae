const WebSocket = require('ws');
const readline = require('readline');
const EventEmitter = require('events');
const Via = require('./lib/index.js').Via;

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });

let ws = new WebSocket("ws://localhost:8080", "viae");
let via = new Via(ws);

via.use((ctx) => {
  if (isPipeable(ctx.res.body)) {
    ctx.res.body.pipe(process.stdout);
    return false;
  }
});

rl.on("line", (line) => {
  via.request({ path: "/greet", body: line });
});

function isPipeable(object) {
  return object.pipe !== undefined && typeof (object.pipe) == "function";
}