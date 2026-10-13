import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import './button.css';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'quiet';
  size?: 'sm' | 'md' | 'lg';
  icon?: IconName;
  iconAfter?: IconName;
  loading?: boolean;
  /** Icon-only buttons must still say what they do. */
  iconOnlyLabel?: string;
  block?: boolean;
  children?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, iconAfter, loading, iconOnlyLabel, block, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  const iconSize = size === 'sm' ? 16 : 18;
  const classes = [
    'button',
    `button--${variant}`,
    `button--${size}`,
    iconOnlyLabel ? 'button--icon-only' : '',
    block ? 'button--block' : '',
    loading ? 'button--loading' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button
      ref={ref}
      type={type}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      aria-label={iconOnlyLabel}
      title={iconOnlyLabel}
      {...rest}
    >
      {loading ? <span className="button__spinner" aria-hidden="true" /> : icon ? <Icon name={icon} size={iconSize} /> : null}
      {children ? <span className="button__label">{children}</span> : null}
      {iconAfter ? <Icon name={iconAfter} size={iconSize} /> : null}
    </button>
  );
});
