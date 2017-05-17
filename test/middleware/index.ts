import interceptorTests from './interceptor';
import unhandledTests from './unhandled';

export default function middlewareTests() {
  describe("Interceptor", () => {
    interceptorTests();
  });
  describe("Unhandled", () => {
    unhandledTests();
  });
}