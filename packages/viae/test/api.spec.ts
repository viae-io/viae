import WebSocket from 'ws';
import { Api, Via, Viae } from '../src';
import { WebSocketWireServer } from './utils';
import { expect } from 'chai';
import { encode as cborEncode } from 'cbor-x';

describe("Api", () => {
  it("should match method and path and return data", async () => {
    const server = new WebSocketWireServer()
    const address = await server.listen(8080, "localhost");
    const viae = new Viae(server);
    const api = new Api("/");

    api.get({
      path: "/",
      handler: ({ data }) => {
        return "Hello " + String(data);
      }
    })

    viae.use(api);

    const wire = new WebSocket(`ws://localhost:8080`);
    const via = new Via({ wire });

    try {
      via.on("error", (err) => {
        throw err;
      });

      await via.ready;

      let result: any = null;

      result = await via.call({ method: "GET", path: "/", data: "John" });
      expect(result, "default encoding").to.be.equal("Hello John");

      result = await via.call({ method: "GET", path: "/", data: "John", encoding: "cbor" });

      expect(result, "default encoding").to.be.equal("Hello John");

    } finally {
      await wire.close();
      await server.close();
    }
  })

  it("should match param", async () => {
    const server = new WebSocketWireServer()
    const address = await server.listen(8080, "localhost");
    const viae = new Viae(server);
    const api = new Api("/");

    api.get({
      path: "/foo/:bar",
      handler: ({ params }) => {
        return "Hello " + String(params.bar);
      }
    })

    viae.use(api);

    const wire = new WebSocket(`ws://localhost:8080`);
    const via = new Via({ wire });

    try {
      via.on("error", (err) => {
        throw err;
      });

      await via.ready;

      let result = await via.call({ method: "GET", path: "/foo/John" });

      expect(result).to.be.equal("Hello John");

    } finally {
      await wire.close();
      await server.close();
    }
  })
})