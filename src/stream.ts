export type ViaStream = {
  $stream: IterableIterator<string | Uint8Array | object> | AsyncIterableIterator<string | Uint8Array | object>
};