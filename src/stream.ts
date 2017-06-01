export interface ViaStream extends AsyncIterableIterator<string | ArrayBuffer | object> {
  dispose();
}