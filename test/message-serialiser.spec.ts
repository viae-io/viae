import { expect } from 'chai';
import { MessageSerialiser } from '../src/message-serialiser';
import { decode } from 'punycode';

describe("Frame Serialiser", () => {
  it("should encode and decode message with header", () => {
    let expected = {
      head: {
        id: "1234"
      }
    };
    let serialiser = new MessageSerialiser();

    let encoded = serialiser.encodeMessage(expected);
    let decoded = serialiser.decodeMessage(encoded);

    expect(decoded).to.deep.equal(expected);
  });

  it("should encode and decode message with header and body", () => {
    let expected = {
      head: {
        id: "1234"
      },
      body: new Uint8Array([5, 6, 7, 8])
    };
    let serialiser = new MessageSerialiser();

    let encoded = serialiser.encodeMessage(expected);
    let decoded = serialiser.decodeMessage(encoded);

    expect(decoded.body).to.deep.equal(expected.body);
  });

  it("should decode and body reuses arraybuffer", () => {

    let serialiser = new MessageSerialiser();
    let encoded = serialiser.encodeMessage({
      head: {
        id: "1234"
      },
      body: new Uint8Array([5, 6, 7, 8])
    });
    let decoded = serialiser.decodeMessage(encoded);

    expect(decoded.body.buffer).to.be.equal(encoded.buffer);
  });
});