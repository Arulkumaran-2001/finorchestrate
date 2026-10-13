import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';
import { Icon, type IconName } from './Icon';
import './forms.css';

/* ------------------------------------------------------------ Field */

interface FieldProps {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  children: (ids: { inputId: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
  optional?: boolean;
  className?: string;
}

export function Field({ label, hint, error, children, optional, className }: FieldProps) {
  const inputId = useId();
  const hintId = useId();
  const errorId = useId();
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className={`field${error ? ' field--invalid' : ''}${className ? ` ${className}` : ''}`}>
      <label className="field__label" htmlFor={inputId}>
        {label}
        {optional ? <span className="field__optional">Optional</span> : null}
      </label>
      {children({ inputId, describedBy, invalid: Boolean(error) })}
      {hint && !error ? (
        <p className="field__hint" id={hintId}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className="field__error" id={errorId} role="alert">
          <Icon name="warning" size={14} />
          {error}
        </p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------ Inputs */

interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  leadingIcon?: IconName;
  prefix?: string;
  invalid?: boolean;
  trailing?: ReactNode;
}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { leadingIcon, prefix, invalid, trailing, className, ...rest },
  ref,
) {
  return (
    <div className={`input${invalid ? ' input--invalid' : ''}${rest.disabled ? ' input--disabled' : ''}${className ? ` ${className}` : ''}`}>
      {leadingIcon ? <Icon name={leadingIcon} size={18} className="input__icon" /> : null}
      {prefix ? <span className="input__prefix">{prefix}</span> : null}
      <input ref={ref} className="input__control" aria-invalid={invalid || undefined} {...rest} />
      {trailing ? <span className="input__trailing">{trailing}</span> : null}
    </div>
  );
});

export const MoneyInput = forwardRef<HTMLInputElement, Omit<TextInputProps, 'prefix' | 'inputMode'>>(function MoneyInput(props, ref) {
  return <TextInput ref={ref} prefix="$" inputMode="decimal" autoComplete="off" spellCheck={false} placeholder="0.00" {...props} />;
});

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(function TextArea(
  { invalid, className, ...rest },
  ref,
) {
  return <textarea ref={ref} className={`textarea${invalid ? ' textarea--invalid' : ''}${className ? ` ${className}` : ''}`} aria-invalid={invalid || undefined} {...rest} />;
});

/* ------------------------------------------------------------ Select */

export interface SelectOption {
  value: string;
  label: string;
  description?: string;
  icon?: IconName;
  tone?: string;
}

interface SelectProps {
  id?: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  ariaLabel?: string;
  size?: 'sm' | 'md';
}

/** Single select listbox following the WAI-ARIA combobox pattern. */
export function Select({ id, value, options, onChange, placeholder = 'Select', disabled, invalid, describedBy, ariaLabel, size = 'md' }: SelectProps) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(() => Math.max(0, options.findIndex((option) => option.value === value)));
  const [placement, setPlacement] = useState<'down' | 'up'>('down');
  const wrapper = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const typeahead = useRef({ text: '', timer: 0 });
  const selected = options.find((option) => option.value === value);

  const close = useCallback((focusTrigger = true) => {
    setOpen(false);
    if (focusTrigger) trigger.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) close(false);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open, close]);

  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const rect = trigger.current.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom;
    setPlacement(below < 300 && rect.top > below ? 'up' : 'down');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const openList = () => {
    if (disabled) return;
    setActive(Math.max(0, options.findIndex((option) => option.value === value)));
    setOpen(true);
  };

  const choose = (index: number) => {
    const option = options[index];
    if (!option) return;
    onChange(option.value);
    close();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const last = options.length - 1;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (!open) openList();
        else setActive((index) => Math.min(last, index + 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (!open) openList();
        else setActive((index) => Math.max(0, index - 1));
        break;
      case 'Home':
        if (open) {
          event.preventDefault();
          setActive(0);
        }
        break;
      case 'End':
        if (open) {
          event.preventDefault();
          setActive(last);
        }
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (open) choose(active);
        else openList();
        break;
      case 'Escape':
        if (open) {
          event.preventDefault();
          close();
        }
        break;
      case 'Tab':
        if (open) setOpen(false);
        break;
      default:
        if (event.key.length === 1 && /\S/.test(event.key)) {
          const buffer = typeahead.current;
          window.clearTimeout(buffer.timer);
          buffer.text += event.key.toLowerCase();
          buffer.timer = window.setTimeout(() => (buffer.text = ''), 600);
          const match = options.findIndex((option) => option.label.toLowerCase().startsWith(buffer.text));
          if (match >= 0) {
            if (open) setActive(match);
            else onChange(options[match]!.value);
          }
        }
    }
  };

  return (
    <div ref={wrapper} className={`select select--${size}${open ? ' select--open' : ''}${invalid ? ' select--invalid' : ''}`}>
      <button
        ref={trigger}
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        aria-describedby={describedBy}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        disabled={disabled}
        className="select__trigger"
        onClick={() => (open ? close() : openList())}
        onKeyDown={onKeyDown}
      >
        {selected?.tone ? <span className={`tone-dot tone-dot--${selected.tone}`} aria-hidden="true" /> : null}
        {selected?.icon ? <Icon name={selected.icon} size={18} className="select__icon" /> : null}
        <span className={`select__value${selected ? '' : ' select__value--placeholder'}`}>{selected?.label ?? placeholder}</span>
        <Icon name="chevronDown" size={18} className="select__chevron" />
      </button>
      {open ? (
        <ul ref={list} id={listId} role="listbox" tabIndex={-1} className={`select__list select__list--${placement}`} aria-label={ariaLabel}>
          {options.map((option, index) => (
            <li
              key={option.value}
              id={`${listId}-${index}`}
              data-index={index}
              role="option"
              aria-selected={option.value === value}
              className={`select__option${index === active ? ' select__option--active' : ''}${option.value === value ? ' select__option--selected' : ''}`}
              onPointerEnter={() => setActive(index)}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => choose(index)}
            >
              {option.tone ? <span className={`tone-dot tone-dot--${option.tone}`} aria-hidden="true" /> : null}
              {option.icon ? <Icon name={option.icon} size={18} className="select__icon" /> : null}
              <span className="select__option-text">
                <span className="select__option-label">{option.label}</span>
                {option.description ? <span className="select__option-description">{option.description}</span> : null}
              </span>
              {option.value === value ? <Icon name="check" size={16} className="select__check" /> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------ Toggle */

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
  hideLabel?: boolean;
}

export function Toggle({ checked, onChange, label, description, disabled, hideLabel }: ToggleProps) {
  const descriptionId = useId();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-describedby={description ? descriptionId : undefined}
      disabled={disabled}
      className={`toggle${checked ? ' toggle--on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="toggle__track" aria-hidden="true">
        <span className="toggle__thumb" />
      </span>
      <span className={hideLabel ? 'visually-hidden' : 'toggle__text'}>
        <span className="toggle__label">{label}</span>
        {description ? (
          <span className="toggle__description" id={descriptionId}>
            {description}
          </span>
        ) : null}
      </span>
    </button>
  );
}

/* ------------------------------------------------------------ Segmented */

interface SegmentedProps<T extends string> {
  value: T;
  options: Array<{ value: T; label: string; icon?: IconName }>;
  onChange: (value: T) => void;
  label: string;
  size?: 'sm' | 'md';
  stretch?: boolean;
}

export function Segmented<T extends string>({ value, options, onChange, label, size = 'md', stretch }: SegmentedProps<T>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const delta = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (!delta) return;
    event.preventDefault();
    const next = (index + delta + options.length) % options.length;
    onChange(options[next]!.value);
    refs.current[next]?.focus();
  };
  return (
    <div role="radiogroup" aria-label={label} className={`segmented segmented--${size}${stretch ? ' segmented--stretch' : ''}`}>
      {options.map((option, index) => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            ref={(element) => {
              refs.current[index] = element;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            className={`segmented__option${checked ? ' segmented__option--checked' : ''}`}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {option.icon ? <Icon name={option.icon} size={16} /> : null}
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------ Slider */

interface SliderProps {
  id?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  label?: string;
  valueText: (value: number) => string;
  describedBy?: string;
  marks?: Array<{ value: number; label: string }>;
}

/** Custom slider: pointer drag on the track plus full keyboard support per the ARIA slider pattern. */
export function Slider({ id, value, min, max, step, onChange, label, valueText, describedBy, marks }: SliderProps) {
  const track = useRef<HTMLDivElement>(null);
  const fraction = (value - min) / (max - min);
  const clamp = (raw: number) => {
    const stepped = Math.round((raw - min) / step) * step + min;
    return Math.min(max, Math.max(min, Number(stepped.toFixed(6))));
  };
  const fromPointer = (clientX: number) => {
    const rect = track.current!.getBoundingClientRect();
    onChange(clamp(min + ((clientX - rect.left) / rect.width) * (max - min)));
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const big = (max - min) / 10;
    const map: Record<string, number> = {
      ArrowRight: value + step,
      ArrowUp: value + step,
      ArrowLeft: value - step,
      ArrowDown: value - step,
      PageUp: value + big,
      PageDown: value - big,
      Home: min,
      End: max,
    };
    if (event.key in map) {
      event.preventDefault();
      onChange(clamp(map[event.key]!));
    }
  };
  return (
    <div className="slider">
      <div
        ref={track}
        className="slider__track"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          fromPointer(event.clientX);
          event.currentTarget.querySelector<HTMLElement>('[role="slider"]')?.focus();
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) fromPointer(event.clientX);
        }}
      >
        <span className="slider__fill" style={{ width: `${fraction * 100}%` }} />
        <div
          id={id}
          role="slider"
          tabIndex={0}
          aria-label={label}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={value}
          aria-valuetext={valueText(value)}
          aria-describedby={describedBy}
          className="slider__thumb"
          style={{ left: `${fraction * 100}%` }}
          onKeyDown={onKeyDown}
        />
      </div>
      {marks ? (
        <div className="slider__marks" aria-hidden="true">
          {marks.map((mark) => (
            <span key={mark.value} className="slider__mark" style={{ left: `${((mark.value - min) / (max - min)) * 100}%` }}>
              {mark.label}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
