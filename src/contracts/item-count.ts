const SINGLE_ITEM_COUNT = 1

export const hasSingleItem = function hasSingleItem(items: Readonly<unknown[]>): boolean {
  return items.length === SINGLE_ITEM_COUNT
}

export const hasMultipleItems = function hasMultipleItems(items: Readonly<unknown[]>): boolean {
  return items.length > SINGLE_ITEM_COUNT
}
