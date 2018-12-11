import { expect } from 'chai';
import { MessageSerialiser } from '../src/message-encoder';
import { Frame } from '../src';

describe("Frame Serialiser", () => {
  it("should encode and decode message with header", () => {
    let expected: Frame = {
      id: "1234"
    };
    let serialiser = new MessageSerialiser();

    let encoded = serialiser.encode(expected);
    let decoded = serialiser.decode(encoded);

    expect(decoded).to.deep.equal(expected);
  });

  it("should encode and decode message with header and body", () => {
    let expected: Frame = {
      id: "1234",
      raw: new Uint8Array([5, 6, 7, 8])
    };
    let serialiser = new MessageSerialiser();

    let encoded = serialiser.encode(expected);
    let decoded = serialiser.decode(encoded);

    expect(decoded.raw).to.deep.equal(expected.raw);
  });

  it("should decode and body reuses arraybuffer", () => {

    let serialiser = new MessageSerialiser();
    let encoded = serialiser.encode({
      id: "1234",
      raw: new Uint8Array([5, 6, 7, 8])
    });
    let decoded = serialiser.decode(encoded);

    expect(decoded.raw.buffer).to.be.equal(encoded.buffer);
  });
});