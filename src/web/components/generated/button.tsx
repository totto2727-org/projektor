import { Button as ButtonPrimitive } from '@base-ui/react/button'
import type { VariantProps } from 'class-variance-authority'
import type * as React from 'react'

// Projektor customization: route class merging through the configured app utility alias.
// Generated shadcn 4.21.1 base-nova behavior and styling are otherwise unchanged.
import { cn } from '@/lib/utils'

import { buttonVariants } from './button-variants.ts'

// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
export const Button = function Button({
  className,
  variant = 'default',
  size = 'default',
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>): React.JSX.Element {
  // oxlint-disable-next-line react/jsx-props-no-spreading, react/forbid-component-props -- Forward the caller's element attributes, accessibility props and handlers through ButtonPrimitive. Base UI Button applies these classes to its own rendered element.
  return <ButtonPrimitive data-slot='button' className={cn(buttonVariants({ variant, size, className }))} {...props} />
}
