import { ViaMessage, ViaContext, Unhandled } from '../../src/index';
import { assert, expect } from 'chai';

export default function unhandledTests() {

    it("sets status 500", async () => {
    const noop = function () {  };
    const unhandled = new Unhandled();
    const err = Error("moo!");
    const ctx: ViaContext = {
      wire: undefined,
      res: { id: "abc" },
      req: { id: "abc" },
      begin: noop,
      send: noop,
      sendStatus: noop,
      end: noop
    };

    let result = await unhandled.process(ctx, err);

    expect(ctx.res.status).to.be.eq(500);
  });

  it("returns error object", async () => {
    const noop = function () { };
    const unhandled = new Unhandled();
    const err = Error("moo!");
    const ctx: ViaContext = {
      wire: undefined,
      res: { id: "abc" },
      req: { id: "abc" },
      begin: noop,
      send: noop,
      sendStatus: noop,
      end: noop
    };

    let result = await unhandled.process(ctx, err);

    expect(result).is.eq(err);
  });
};