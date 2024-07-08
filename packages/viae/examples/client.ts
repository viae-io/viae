import { Via } from '../src';
import WebSocket from 'ws';

let wire = new WebSocket("ws://0.0.0.0:8080", { perMessageDeflate: false });
let via = new Via({ wire: wire as any });

async function measure(name: string, elmt: number, cb: () => Promise<void>) {
  let entry: any[] = [];

  console.log(name + " x"+elmt);

  for (let i = 0; i < 100; i++) {
    let start = new Date();

    await cb();

    let took = ((new Date().getTime() - start.getTime()) / 1000);

    entry.push(took);
  }

  let slowest = entry.sort()[0];
  let fastest = entry.sort().reverse()[0];
  let average = entry.reduce((p, c) => p + c / 100, 0);
  let elmtPerSec = (elmt) / average;


  console.log(" min: " + slowest + " sec");
  console.log(" max: " + fastest + " sec");
  console.log(" avg: " + average + " sec");
  console.log(" tps: " + elmtPerSec);
}

via.on("open", async () => {
  await measure("no data", 1000, async () => {
    let cache: any[] = [];
    for (let i = 0; i < 1000; i++) {
      cache.push(via.request("POST", "/root"));
    }
    await Promise.all(cache);
  });

  await measure("string as msgpack (default)", 1000, async () => {
    let cache: any[] = [];
    for (let i = 0; i < 1000; i++) {
      cache.push(via.request("POST", "/root", "hello world"));
    }
    await Promise.all(cache);
  }); 
  
  await measure("string as cbor (default)", 1000, async () => {
    let cache: any[] = [];
    for (let i = 0; i < 1000; i++) {
      cache.push(via.request("POST", "/root", "hello world",  { encoding: "cbor" }));
    }
    await Promise.all(cache);
  });

  await measure("string as json", 1000, async () => {
    let cache: any[] = [];
    for (let i = 0; i < 1000; i++) {
      cache.push(via.request("POST", "/root", "hello world", { encoding: "json" }));
    }
    await Promise.all(cache);
  });

  await measure("uint8array as none", 1000, async () => {
    let cache: any[] = [];
    for (let i = 0; i < 1000; i++) {
      cache.push(via.request("POST", "/root", new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])));
    }
    await Promise.all(cache);
  });


  let data1 = new Uint8Array(new Array(1024).fill(0));
  let data2 = new Uint8Array(new Array(8192).fill(0));
  let data3 = new Uint8Array(new Array(65536).fill(0));
  let data4 = new Uint8Array(new Array(1024).fill(0).map(() => Math.round(Math.random() * 255)));
  let data5 = new Uint8Array(new Array(8192).fill(0).map(() => Math.round(Math.random() * 255)));
  let data6 = new Uint8Array(new Array(65536).fill(0).map(() => Math.round(Math.random() * 255)));

  await measure("1K (zeros)", 1000, async () => {
    let cache: Array<Promise<any>> = [];

    for (let j = 0; j < 1000; j++) {
      cache.push(via.request("POST", "/root", data1));
    }

    await Promise.all(cache);
  });


  await measure("8K (zeros)", 1000, async () => {
    let cache: Array<Promise<any>> = [];

    for (let i = 0; i < 1000; i++) {
      cache.push(via.request("POST", "/root", data2));
    }
    await Promise.all(cache);
  });

  await measure("64K (zeros)", 1000, async () => {
    let cache: Array<Promise<any>> = [];

    for (let i = 0; i < 1000; i++) {
      cache.push(via.request("POST", "/root", data3));
    }
    await Promise.all(cache);
  });

  await measure("1K (random)", 100, async () => {
    let cache: Array<Promise<any>> = [];

    for (let j = 0; j < 100; j++) {
      cache.push(via.request("POST", "/root", data4));
    }

    await Promise.all(cache);
  });


  await measure("8K (random)", 100, async () => {
    let cache: Array<Promise<any>> = [];

    for (let i = 0; i < 100; i++) {
      cache.push(via.request("POST", "/root", data5));
    }
    await Promise.all(cache);
  });

  await measure("64K (random)", 100, async () => {
    let cache: Array<Promise<any>> = [];

    for (let i = 0; i < 100; i++) {
      cache.push(via.request("POST", "/root", data6, { timeout: 5000 }));
    }
    await Promise.all(cache);
  });

  wire.close();
});

via.on("error", (err) => {
  console.log(err);
});