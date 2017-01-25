import { Method, Message, MessageSerialiser } from '../src/index';
import { assert, expect } from 'chai';


describe("Message", () => {
  describe("Serialiser", () => {
    it("should correctly serialise empty message", () => {

      let msg: Message = {
      };

      let serialiser = new MessageSerialiser();

      let bin = serialiser.encode(msg);

      expect(bin.length).equals(8);

      let result = serialiser.decode(bin);

      expect(result.id).to.not.be.undefined;

      if (result.id)
        expect(result.id.length).equals(16);
    });

    it("should correctly serialise message with id", () => {

      let msg: Message = {
        id: "f0e1d2c3b4a59687"
      };

      let serialiser = new MessageSerialiser();

      let bin = serialiser.encode(msg);

      expect(bin.length).to.equal(8);

      let result = serialiser.decode(bin);

      expect(result.id).to.equal("f0e1d2c3b4a59687");

    });

    it("should correctly serialise message with status", () => {

      let msg: Message = {
        id: "f0e1d2c3b4a59687",
        status: 404
      };

      let serialiser = new MessageSerialiser();
      let bytes = serialiser.encode(msg);

      expect(bytes.length).to.equal(10);

      let result = serialiser.decode(bytes);

      expect(result.id).to.equal("f0e1d2c3b4a59687");
      expect(result.status).to.equal(404);
    });

    it("should correctly serialise message with string body", () => {

      let msg: Message = {
        id: "f0e1d2c3b4a59687",
        body: "hello world",
      };

      let serialiser = new MessageSerialiser();
      let bytes = serialiser.encode(msg);

      expect(bytes.length).to.equal(20);

      let result = serialiser.decode(bytes);

      expect(result.id).to.equal("f0e1d2c3b4a59687");
      expect(result.body).to.equal("hello world");
    });

    it("should correctly serialise message with object body", () => {

      let msg: Message = {
        body: { foo: "bar" },
      };

      let serialiser = new MessageSerialiser();
      let result = serialiser.decode(serialiser.encode(msg));

      expect(result.body).to.deep.equal({ foo: "bar" });
    });

    it("should correctly serialise message with Uint8Array body", () => {

      let msg: Message = {
        body: new Uint8Array([1, 2, 3, 4]),
      };

      let serialiser = new MessageSerialiser();
      let result = serialiser.decode(serialiser.encode(msg));

      expect(result.body).to.deep.equal(new Uint8Array([1, 2, 3, 4]));
    });

    it("should correctly serialise message with headers", () => {

      let msg: Message = {
        headers: {
          foo: "bar",
          ray: "day"
        }
      };
      let serialiser = new MessageSerialiser();
      let result = serialiser.decode(serialiser.encode(msg));

      expect(result.headers).to.deep.equal({
        foo: "bar",
        ray: "day"
      });
    });

    it("should correctly serialise message with method", () => {

      let msg: Message = {
        method: Method.GET,
      };

      let serialiser = new MessageSerialiser();
      let result = serialiser.decode(serialiser.encode(msg));

      expect(result).not.to.deep.equal(msg);
      expect(result.method).to.equal(msg.method);
    });

    it("should correctly serialise message with all fields", () => {

      let msg: Message = {
        id: "f0e1d2c3b4a59687",
        method: Method.SUBSCRIBE,
        status: 100,
        path: "path/to/resource",
        body: "hello world",
        headers: {
          foo: "bar",
          ray: "day"
        },
        flags: 0xf,
      };

      let serialiser = new MessageSerialiser();
      let result = serialiser.decode(serialiser.encode(msg));

      expect(result).to.not.equal(msg);
      expect(result).to.deep.equal(msg);
    });
  });
});