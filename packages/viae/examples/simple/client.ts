import { Via } from '../../src';
import WebSocket from 'ws';
import { toArray, toPromise } from 'web-streams-extensions';
import { access } from 'fs';

(async function main() {
  let wire = new WebSocket("ws://0.0.0.0:8080", { perMessageDeflate: false });
  let via = new Via({ wire: wire as any });

  via.on("error", (err) => {
    console.log(err);
  });

  via.on("open", async () => {
    {
      await using result = await via.request(
        "GET",
        "/echo",
        new ReadableStream({ start(controller) { controller.enqueue("hello"), controller.close(); } }),
        {
          accept: "stream",
          validate(value): value is string {
            return true
          },
        }
      )
      if (result.ok) {
        let payloads = await toArray(result.data);
        console.log(payloads);
      }
    }

    wire.close();
  })
})().catch(console.error);


