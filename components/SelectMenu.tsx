"use client";

import { createPortal } from "react-dom";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { Check, ChevronDown } from "lucide-react";

export interface SelectMenuOption<Value extends string> {
  value: Value;
  label: string;
  description?: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
}

interface SelectMenuProps<Value extends string> {
  value: Value;
  options: readonly SelectMenuOption<Value>[];
  onChange: (value: Value) => void;
  ariaLabel: string;
  disabled?: boolean;
  className?: string;
  buttonClassName?: string;
}

interface MenuPosition {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
}

const VIEWPORT_MARGIN = 8;
const MENU_GAP = 6;
const MAX_MENU_HEIGHT = 320;

export default function SelectMenu<Value extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  disabled = false,
  className = "",
  buttonClassName = "",
}: SelectMenuProps<Value>) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [position, setPosition] = useState<MenuPosition | null>(null);

  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const selectedOption = options[selectedIndex];

  const updatePosition = useCallback(() => {
    const button = buttonRef.current;
    if (!button) {
      return;
    }

    const rect = button.getBoundingClientRect();
    const availableBelow = window.innerHeight - rect.bottom - VIEWPORT_MARGIN - MENU_GAP;
    const availableAbove = rect.top - VIEWPORT_MARGIN - MENU_GAP;
    const desiredHeight = Math.min(
      MAX_MENU_HEIGHT,
      options.reduce((height, option) => height + (option.description ? 52 : 36), 8),
    );
    const placeBelow = availableBelow >= Math.min(desiredHeight, 144)
      || availableBelow >= availableAbove;
    const maxHeight = Math.max(72, Math.min(
      desiredHeight,
      placeBelow ? availableBelow : availableAbove,
    ));
    const width = Math.min(
      Math.max(rect.width, 160),
      window.innerWidth - VIEWPORT_MARGIN * 2,
    );
    const left = Math.min(
      Math.max(VIEWPORT_MARGIN, rect.left),
      window.innerWidth - width - VIEWPORT_MARGIN,
    );

    setPosition({
      top: placeBelow
        ? rect.bottom + MENU_GAP
        : Math.max(VIEWPORT_MARGIN, rect.top - maxHeight - MENU_GAP),
      left,
      width,
      maxHeight,
    });
  }, [options.length]);

  const close = useCallback(() => {
    setOpen(false);
    setPosition(null);
  }, []);

  const openMenu = useCallback(() => {
    if (disabled || options.length === 0) {
      return;
    }
    setActiveIndex(selectedIndex);
    setOpen(true);
  }, [disabled, options.length, selectedIndex]);

  useEffect(() => {
    if (!open) {
      return;
    }
    updatePosition();
    const reposition = () => updatePosition();
    const closeOnPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!buttonRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        close();
      }
    };
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    document.addEventListener("pointerdown", closeOnPointerDown);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
      document.removeEventListener("pointerdown", closeOnPointerDown);
    };
  }, [close, open, updatePosition]);

  const enabledIndex = (start: number, direction: 1 | -1): number => {
    if (options.length === 0) {
      return -1;
    }
    let index = start;
    for (let checked = 0; checked < options.length; checked += 1) {
      index = (index + direction + options.length) % options.length;
      if (!options[index].disabled) {
        return index;
      }
    }
    return -1;
  };

  const choose = (index: number) => {
    const option = options[index];
    if (!option || option.disabled) {
      return;
    }
    onChange(option.value);
    close();
    buttonRef.current?.focus();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) {
      return;
    }
    if (!open) {
      if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(event.key)) {
        event.preventDefault();
        openMenu();
        if (event.key === "ArrowUp") {
          const lastEnabled = enabledIndex(0, -1);
          if (lastEnabled >= 0) {
            setActiveIndex(lastEnabled);
          }
        }
      }
      return;
    }

    switch (event.key) {
    case "ArrowDown": {
      event.preventDefault();
      const next = enabledIndex(activeIndex, 1);
      if (next >= 0) setActiveIndex(next);
      break;
    }
    case "ArrowUp": {
      event.preventDefault();
      const previous = enabledIndex(activeIndex, -1);
      if (previous >= 0) setActiveIndex(previous);
      break;
    }
    case "Home": {
      event.preventDefault();
      const first = options.findIndex((option) => !option.disabled);
      if (first >= 0) setActiveIndex(first);
      break;
    }
    case "End": {
      event.preventDefault();
      const last = options.findLastIndex((option) => !option.disabled);
      if (last >= 0) setActiveIndex(last);
      break;
    }
    case "Enter":
    case " ":
      event.preventDefault();
      choose(activeIndex);
      break;
    case "Escape":
      event.preventDefault();
      event.stopPropagation();
      close();
      break;
    case "Tab":
      close();
      break;
    default:
      break;
    }
  };

  const menu = open && position && createPortal(
    <div
      ref={menuRef}
      id={listboxId}
      role="listbox"
      aria-label={ariaLabel}
      style={{
        top: position.top,
        left: position.left,
        width: position.width,
        maxHeight: position.maxHeight,
      }}
      className="fixed z-[200] overflow-y-auto rounded-md border border-[#665442] bg-[#1d1a18] p-1 shadow-[0_18px_45px_rgba(0,0,0,0.52)]"
    >
      {options.map((option, index) => {
        const selected = option.value === value;
        const active = index === activeIndex;
        return (
          <button
            key={option.value}
            id={`${listboxId}-option-${index}`}
            type="button"
            role="option"
            aria-selected={selected}
            disabled={option.disabled}
            tabIndex={-1}
            onMouseEnter={() => !option.disabled && setActiveIndex(index)}
            onClick={() => choose(index)}
            className={`flex min-h-9 w-full min-w-0 items-center gap-2 rounded px-2.5 py-1 text-left text-sm leading-5 outline-none transition-colors ${active ? "bg-[#3a3026] text-[#f4dfb8]" : "text-[#cdbfa9] hover:bg-[#2b2621] hover:text-[#eadfcf]"} disabled:cursor-not-allowed disabled:opacity-45`}
          >
            {option.icon && (
              <span aria-hidden="true" className="flex h-5 w-5 shrink-0 items-center justify-center">
                {option.icon}
              </span>
            )}
            <span className="min-w-0 flex-1 truncate leading-5">
              <span className="block truncate">{option.label}</span>
              {option.description && (
                <span className="block truncate text-[11px] leading-4 text-[#9e8c74]">
                  {option.description}
                </span>
              )}
            </span>
            <Check
              size={15}
              aria-hidden="true"
              className={`shrink-0 text-[#e3b967] ${selected ? "opacity-100" : "opacity-0"}`}
            />
          </button>
        );
      })}
    </div>,
    document.body,
  );

  return (
    <div className={`relative min-w-0 ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={open ? `${listboxId}-option-${activeIndex}` : undefined}
        data-select-menu-open={open ? "true" : "false"}
        onClick={() => open ? close() : openMenu()}
        onKeyDown={handleKeyDown}
        className={`flex h-10 w-full min-w-0 items-center gap-2 rounded-md border border-[#534741]/70 bg-[#1a1816] px-3 text-sm leading-5 text-[#eae6db] outline-none transition-colors hover:border-[#756655] focus-visible:border-amber-500/60 focus-visible:ring-2 focus-visible:ring-amber-500/15 disabled:cursor-wait disabled:opacity-50 ${buttonClassName}`}
      >
        {selectedOption?.icon && (
          <span aria-hidden="true" className="flex h-5 w-5 shrink-0 items-center justify-center">
            {selectedOption.icon}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-left leading-5">{selectedOption?.label || value}</span>
        <ChevronDown
          size={15}
          aria-hidden="true"
          className={`shrink-0 text-[#9b876a] transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {menu}
    </div>
  );
}
