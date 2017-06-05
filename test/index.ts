import { Message } from '../src/index';
import { assert, expect } from 'chai';

import middlewareTests from './middleware';
import messageTests from './message.spec';

describe("Viae", () => {
  describe("Middleware", () => {
    middlewareTests();
  });
  describe("Message", () => {
    messageTests();
  });
});
