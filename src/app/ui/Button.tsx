/**
 * Buttons (M9 part 2, design plan §3.5). The look lives in CSS classes, so plain markup works too:
 *
 *   class            look                                   old name (still works)
 *   btn              grey: the default                      btn
 *   btn btn-filled   accent fill, the one main action       btn-primary
 *   btn btn-tinted   light accent, accent words             btn-on (a pressed toggle)
 *   btn btn-plain    words only, accent
 *   btn btn-destructive  light red, red words               btn-danger
 *   btn btn-destructive btn-filled  red fill (a final "Delete")
 *   btn btn-good     green fill: "It fits"                  btn-fits
 *   + btn-small      44 px tall, 15 px words (default 52 px, 17 px)
 *   + btn-block      full width
 *   btn-icon         icon only: a 36 px circle inside a 44 px hit area (give it an aria-label)
 *
 * All have press feedback (scale .97 over 120 ms, none under Reduce Motion) and a focus ring for keyboards.
 *
 *   <Button variant="filled" block onClick={…}>Scan pieces</Button>
 *   <IconButton label="Close" onClick={…}><Icon name="x" /></IconButton>
 */
import type { ButtonHTMLAttributes, ComponentChildren } from 'preact';

export type ButtonVariant = 'grey' | 'filled' | 'tinted' | 'plain' | 'destructive' | 'destructive-filled' | 'good';

const VARIANT: Record<ButtonVariant, string> = {
  grey: '',
  filled: ' btn-filled',
  tinted: ' btn-tinted',
  plain: ' btn-plain',
  destructive: ' btn-destructive',
  'destructive-filled': ' btn-destructive btn-filled',
  good: ' btn-good',
};

/** The class string for a button look, for links and labels that must look like buttons. */
export function buttonClass(variant: ButtonVariant = 'grey', opts: { small?: boolean; block?: boolean; extra?: string } = {}): string {
  return `btn${VARIANT[variant]}${opts.small ? ' btn-small' : ''}${opts.block ? ' btn-block' : ''}${opts.extra ? ` ${opts.extra}` : ''}`;
}

type ButtonAttrs = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'class' | 'className'>;

export interface ButtonProps extends ButtonAttrs {
  variant?: ButtonVariant;
  small?: boolean;
  block?: boolean;
  /** More classes. */
  class?: string;
  testId?: string;
  children?: ComponentChildren;
}

export function Button({ variant = 'grey', small, block, class: extra, testId, type = 'button', children, ...rest }: ButtonProps) {
  return (
    <button {...rest} type={type} class={buttonClass(variant, { small, block, extra })} data-testid={testId}>
      {children}
    </button>
  );
}

export interface IconButtonProps extends ButtonAttrs {
  /** What it does, for VoiceOver (the icon itself is hidden from it). */
  label: string;
  /** Light accent circle instead of grey. */
  tinted?: boolean;
  class?: string;
  testId?: string;
  children?: ComponentChildren;
}

export function IconButton({ label, tinted, class: extra, testId, type = 'button', children, ...rest }: IconButtonProps) {
  return (
    <button {...rest} type={type} class={`btn-icon${tinted ? ' btn-tinted' : ''}${extra ? ` ${extra}` : ''}`} aria-label={label} data-testid={testId}>
      <span aria-hidden="true" class="btn-icon-glyph">
        {children}
      </span>
    </button>
  );
}
