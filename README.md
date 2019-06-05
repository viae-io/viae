# Viae

A bi-directional communication framework. 

![logopng](https://user-images.githubusercontent.com/3584509/31079620-2603bc88-a77e-11e7-92c8-7ac73c165b0b.png)

[![NPM version][npm-image]][npm-url]
[![NPM downloads][npm-downloads]][npm-url]
[![Travis Status][travis-image]][travis-url]
[![codecov](https://codecov.io/gh/MeirionHughes/viae/branch/master/graph/badge.svg)](https://codecov.io/gh/MeirionHughes/viae)
[![Stability][stability-image]][stability-url]


Currently still under development. 

The goal in developing viae was to allow making asynchronous req/res on a single websocket connection and to allow sending objects containing `TypedArrayView` instances. It evolved to facilitate sending and receiving rxjs Observables (stream request, stream response);

## Basic Usage

A server is created by instantiating a `Viae` instance and passing a `WebSocketServer` instance to it: 

```ts
let server = new WebSocketServer({ port: 8080, host: "0.0.0.0" });
let viae = new Viae(server);
```

request middleware can then be added using: 

```ts
viae.use(async (ctx, next) => {
  //do something with ctx
  return next();
});
```

A controller-based router is available by using

```ts
@Controller('chat')
class ChatRoomController {
  private _channel = new Subject<string>();

  @Get()
  join() {
    return this._channel;
  }

  @Post()
  addMsg(@Data() msg: string){
    this._channel.next(msg);
    return Status.OK;        
  }
}

viae.use(new App({
  controllers: [new ChatRoomController()]
}));

```

a client is created by instantiating a `Via` instance and making requests


```ts
let wire = new WebSocket("ws://0.0.0.0:8080");
let via = new Via({ wire: wire as any });

via.on("open", async () => {

  let joinRes = await via.request("GET", "/chat");

  if (isObservable(joinRes.data)) {
    joinRes.data.forEach(x => console.log(x));
  }

  await via.request("POST", "/chat", "hello world...");

  await new Promise((r, _) => setTimeout(r, 100));

  wire.close();
});
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
