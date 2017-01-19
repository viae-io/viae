# Viae

A bi-directional communication api framework with streaming support. 

![363886-200](https://cloud.githubusercontent.com/assets/3584509/22102513/a04d0904-de2f-11e6-9591-ebfa2516ea07.png)

[![NPM version][npm-image]][npm-url]
[![NPM downloads][npm-downloads]][npm-url]
[![Travis Status][travis-image]][travis-url]
[Stability][stability-image]

## install

* `npm install viae` 

## Usage

check [Documentation](https://github.com/MeirionHughes/viae/wiki) for more examples; 




### WebSocket - Client

```ts
const WebSocket = require('ws'); // or browser
const Via = require('viae').Via;

let ws = new WebSocket("ws://localhost:8080", "viae");
let via = new Via(ws);

```

### WebSocket - Server

```ts
const WebSocketServer = require('ws').Server;
const Viae = require('viae').Viae;

let wss = new WebSocketServer({ port: 8080, handleProtocols: ["viae"] });
let server = new Viae(wss);
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
