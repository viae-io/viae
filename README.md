# Viae

A bi-directional communication api framework with streaming support. 

![363886-200](https://cloud.githubusercontent.com/assets/3584509/22102513/a04d0904-de2f-11e6-9591-ebfa2516ea07.png)

[![NPM version][npm-image]][npm-url]
[![NPM downloads][npm-downloads]][npm-url]
[![Travis Status][travis-image]][travis-url]
[![codecov](https://codecov.io/gh/MeirionHughes/viae/branch/master/graph/badge.svg)](https://codecov.io/gh/MeirionHughes/viae)
[![Stability][stability-image]][stability-url]

## Install

* `npm install viae`

## Usage

Check [Documentation](https://github.com/MeirionHughes/viae/wiki) 

Currently under development and subject to potential breaking changes between minor versions. 

### Viae Server (WebSocket)

```ts
const WebSocketServer = require('ws').Server;
const Viae = require('viae').Viae;

let wss = new WebSocketServer({ port: 8080 });
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
    }]
});

server.route({
  method: "PING",
  path: "/",
  handlers: [(ctx: ViaContext) => ctx.sendStatus(200)]
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

server.before((ctx: ViaContext) => {
  ctx["_start"] = process.hrtime();
});

server.after((ctx: ViaContext) => {
  let start = ctx["_start"];
  let hrspan = process.hrtime(start);
  let span = hrspan[0] * 1000 + hrspan[1] / 1000000;
  console.log(`${ctx.req.method} ${ctx.req.path} - ${ctx.res.status} (${span}ms)`);
});

console.log("Server Running on 9090....");
```

### Via Client (WebSocket)

```ts
const WebSocket = require('ws'); // or browser's
const Via = require('viae').Via;

let ws = new WebSocket("ws://localhost:8080");
let via = new Via(ws);

let ws = new Ws("ws://localhost:9090");
let via = new Via(ws);

ws.on("open", () => {
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

  via.send({ method: "GET", path: "/nothing" });
});

function isPipeable(obj) {
  return obj.pipe !== undefined && typeof (obj.pipe) == "function";
}
```

## Build

```
npm install
npm test
```

## Credits
"Cross" Icon courtesy of [The Noun Project](https://thenounproject.com/), by [Alexander Skowalsky](https://thenounproject.com/sandorsz/), under [CC 3.0](http://creativecommons.org/licenses/by/3.0/us/)

[npm-url]: https://npmjs.org/package/viae
[npm-image]: http://img.shields.io/npm/v/viae.svg
[npm-downloads]: http://img.shields.io/npm/dm/viae.svg
[travis-url]: https://travis-ci.org/MeirionHughes/viae
[travis-image]: https://img.shields.io/travis/MeirionHughes/viae/master.svg
[stability-image]: https://img.shields.io/badge/stability-1%20%3A%20unstable-red.svg
[stability-url]: https://nodejs.org/api/documentation.html#documentation_stability_index
