import { ViaMessage } from '../src/index';
import { assert, expect } from 'chai';


describe("Message", () => {
  describe("Serialiser", () => {
    it("should correctly serialise empty message", () => {

      let msg: ViaMessage = {
      };


      let bin = ViaMessage.serialiseBinary(msg);

      expect(bin.length).equals(8);

      let result = ViaMessage.deserialiseBinary(bin);

      expect(result.id).to.not.be.undefined;

      if (result.id)
        expect(result.id.length).equals(16);
    });

    it("should correctly serialise message with id", () => {

      let msg: ViaMessage = {
        id: "f0e1d2c3b4a59687"
      };

      let bin = ViaMessage.serialiseBinary(msg);

      expect(bin.length).to.equal(8);

      let result = ViaMessage.deserialiseBinary(bin);

      expect(result.id).to.equal("f0e1d2c3b4a59687");

    });

    it("should correctly serialise message with status", () => {

      let msg: ViaMessage = {
        id: "f0e1d2c3b4a59687",
        status: 404
      };


      let bytes = ViaMessage.serialiseBinary(msg);

      expect(bytes.length).to.equal(10);

      let result = ViaMessage.deserialiseBinary(bytes);

      expect(result.id).to.equal("f0e1d2c3b4a59687");
      expect(result.status).to.equal(404);
    });

    it("should correctly serialise message with string body", () => {

      let msg: ViaMessage = {
        id: "f0e1d2c3b4a59687",
        body: "hello world",
      };


      let bytes = ViaMessage.serialiseBinary(msg);

      expect(bytes.length).to.equal(20);

      let result = ViaMessage.deserialiseBinary(bytes);

      expect(result.id).to.equal("f0e1d2c3b4a59687");
      expect(result.body).to.equal("hello world");
    });

    it("should correctly serialise message with object body", () => {

      let msg: ViaMessage = {
        body: { foo: "bar" },
      };


      let result = ViaMessage.deserialiseBinary(ViaMessage.serialiseBinary(msg));

      expect(result.body).to.deep.equal({ foo: "bar" });
    });

    it("should correctly serialise message with json-string body", () => {

      let msg: ViaMessage = {
        body: ' {"foo":"bar"}    ',
      };

      let result = ViaMessage.deserialiseBinary(ViaMessage.serialiseBinary(msg));

      expect(result.body).to.deep.equal({ foo: "bar" });
    });

    it("should correctly serialise message with Uint8Array body", () => {

      let msg: ViaMessage = {
        body: new Uint8Array([1, 2, 3, 4]),
      };


      let result = ViaMessage.deserialiseBinary(ViaMessage.serialiseBinary(msg));

      expect(result.body).to.deep.equal(new Uint8Array([1, 2, 3, 4]));
    });

    it("should correctly serialise message with headers", () => {

      let msg: ViaMessage = {
        headers: {
          foo: "bar",
          ray: "day"
        }
      };

      let result = ViaMessage.deserialiseBinary(ViaMessage.serialiseBinary(msg));

      expect(result.headers).to.deep.equal({
        foo: "bar",
        ray: "day"
      });
    });

    it("should correctly serialise message with method", () => {

      let msg: ViaMessage = {
        method: "GET",
      };

      let result = ViaMessage.deserialiseBinary(ViaMessage.serialiseBinary(msg));

      expect(result).not.to.deep.equal(msg);
      expect(result.method).to.equal(msg.method);
    });

    it("should correctly serialise message with all fields", () => {

      let msg: ViaMessage = {
        id: "f0e1d2c3b4a59687",
        method: "SUBSCRIBE",
        status: 100,
        path: "path/to/resource",
        body: "hello world",
        headers: {
          foo: "bar",
          ray: "day"
        },
        flags: 0xf,
      };


      let result = ViaMessage.deserialiseBinary(ViaMessage.serialiseBinary(msg));

      expect(result).to.not.equal(msg);
      expect(result).to.deep.equal(msg);
    });
  });
});