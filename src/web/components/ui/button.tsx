import type { JSX, AnchorHTMLAttributes, ButtonHTMLAttributes, CSSProperties, ReactNode } from 'react'

import { buttonVariants } from '@/components/generated/button-variants.ts'
import { Button as PrimitiveButton } from '@/components/generated/button.tsx'

interface CommonProps {
  variant?: 'primary' | 'outline' | 'danger'
  size?: 'sm'
  class?: string
  className?: string
  style?: CSSProperties
  children: ReactNode
}
export type ButtonProps = CommonProps &
  (
    | ({ as?: 'button'; href?: never } & ButtonHTMLAttributes<HTMLButtonElement>)
    | ({ as: 'a'; href: string } & AnchorHTMLAttributes<HTMLAnchorElement>)
    | { as: 'span'; href?: never }
  )

/**
 * Compatibility props only. Base UI owns button interaction and native form semantics.
 *
 * @param {ButtonProps} props The element kind, presentation, content, and native button or link attributes.
 * @returns {JSX.Element} The chosen button, anchor, or span with the configured presentation.
 */
// oxlint-disable-next-line react/function-component-definition -- eslint/func-style requires a function expression.
export const Button = function Button({
  variant,
  size,
  as = 'button',
  href,
  class: legacyClass,
  className,
  style,
  children,
  ...rest
}: ButtonProps): JSX.Element {
  const classes = [
    as !== 'button' &&
      buttonVariants({
        variant: variant === 'danger' ? 'destructive' : variant === 'outline' ? 'outline' : 'default',
        size,
      }),
    legacyClass,
    className,
  ]
    .filter(Boolean)
    .join(' ')
  if (as === 'span') {
    return (
      <span className={classes} style={style}>
        {children}
      </span>
    )
  }
  if (as === 'a') {
    return (
      <a {...(rest as AnchorHTMLAttributes<HTMLAnchorElement>)} href={href} className={classes} style={style}>
        {children}
      </a>
    )
  }
  return (
    <PrimitiveButton
      {...(rest as ButtonHTMLAttributes<HTMLButtonElement>)}
      type={(rest as ButtonHTMLAttributes<HTMLButtonElement>).type ?? 'button'}
      variant={variant === 'danger' ? 'destructive' : variant === 'outline' ? 'outline' : 'default'}
      size={size}
      className={classes}
      style={style}
    >
      {children}
    </PrimitiveButton>
  )
}
