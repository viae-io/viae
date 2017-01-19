import { Method, Message, MessageSerialiser } from '../src/index';

describe("Message", () => {
  describe("Serialiser", () => {
    it("should correctly serialise empty message", () => {

      let msg: Message = {
      };

      let serialiser = new MessageSerialiser();

      let bin = serialiser.encode(msg);

      expect(bin.length).toBe(8);

      let result = serialiser.decode(bin);

      expect(result.id).toBeDefined();
      expect(result.id.length).toBe(16);
    });

    it("should correctly serialise message with id", () => {

      let msg: Message = {
        id: "f0e1d2c3b4a59687"
      };

      let serialiser = new MessageSerialiser();

      let bin = serialiser.encode(msg);

      expect(bin.length).toBe(8);

      let result = serialiser.decode(bin);

      expect(result.id).toBe("f0e1d2c3b4a59687");

    });

    it("should correctly serialise message with status", () => {

      let msg: Message = {
        id: "f0e1d2c3b4a59687",
        status: 404
      };

      let serialiser = new MessageSerialiser();
      let bytes = serialiser.encode(msg);

      expect(bytes.length).toBe(10);

      let result = serialiser.decode(bytes);

      expect(result.id).toBe("f0e1d2c3b4a59687");
      expect(result.status).toBe(404);
    });

    it("should correctly serialise message with string body", () => {

      let msg: Message = {
        id: "f0e1d2c3b4a59687",
        body: "hello world",
      };

      let serialiser = new MessageSerialiser();
      let bytes = serialiser.encode(msg);

      expect(bytes.length).toBe(20);

      let result = serialiser.decode(bytes);

      expect(result.id).toBe("f0e1d2c3b4a59687");
      expect(result.body).toBe("hello world");
    });

    it("should correctly serialise message with object body", () => {

      let msg: Message = {
        body: { foo: "bar" },
      };

      let serialiser = new MessageSerialiser();
      let result = serialiser.decode(serialiser.encode(msg));

      expect(result.body).toEqual({ foo: "bar" });
    });

    it("should correctly serialise message with Uint8Array body", () => {

      let msg: Message = {
        body: new Uint8Array([1, 2, 3, 4]),
      };

      let serialiser = new MessageSerialiser();
      let result = serialiser.decode(serialiser.encode(msg));

      expect(result.body).toEqual(new Uint8Array([1, 2, 3, 4]));
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

      expect(result.headers).toEqual({
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

      expect(result).not.toBe(msg);
      expect(result.method).toEqual(msg.method);
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

      expect(result).not.toBe(msg);
      expect(result).toEqual(msg);
    });
  });
});