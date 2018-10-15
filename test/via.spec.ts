import { expect } from 'chai';
import { EventEmitter } from 'events';

import {Wire} from '../src/wire';
import { Via } from '../src';


function mockWire() {
  return Object.assign(new EventEmitter(), {
    state: "closed",
    send: (data: ArrayBuffer) => Promise.resolve(),
    close: () => Promise.resolve(),
  }) as Wire;
}

describe("Via", () => {
  it("should subscribe to wire events", async () => {
    let wire = mockWire();

    let via = new Via(wire);

  });
});