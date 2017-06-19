import { Viae } from './viae';

export type ViaePlugin = {
  plugin(viae: Viae): void
};

export function isPlugin(item: any): item is ViaePlugin {
  return item["plugin"] !== undefined;
}
