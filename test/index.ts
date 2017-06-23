import { Message } from '../src/index';
import { assert, expect } from 'chai';

import middlewareTests from './middleware';

describe("Viae", () => {
  describe("Middleware", () => {
    middlewareTests();
  });
});
