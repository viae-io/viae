export function isReadableStream(obj: any): obj is ReadableStream<any> {
  if (obj == null)
    return false;
  if (obj instanceof ReadableStream)
    return true;
  if (obj.getReader != null)
    return true;
  return false;
}
