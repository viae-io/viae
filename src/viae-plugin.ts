import { Viae } from './viae';
import { Via } from './via';

export type ViaePlugin = {
  plugin(target: Viae | Via): void
};

export function isPlugin(item: any): item is ViaePlugin {
  return item["plugin"] !== undefined;
}
