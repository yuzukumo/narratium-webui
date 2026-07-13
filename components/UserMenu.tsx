"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import {
  ChevronDown,
  LoaderCircle,
  LogOut,
  Settings,
  ShieldCheck,
} from "lucide-react";
import { toast } from "react-hot-toast";
import { useLanguage } from "@/app/i18n";
import { useAuth } from "@/contexts/AuthContext";
import UserSettingsModal from "@/components/UserSettingsModal";
import UserAvatar from "@/components/UserAvatar";

export interface UserMenuProps {
  compact?: boolean;
  mobile?: boolean;
  placement?: "top" | "bottom";
  className?: string;
}

interface MenuPosition {
  left: number;
  top: number;
}

type PendingMenuFocus = "first" | "last" | null;

const MENU_WIDTH = 208;
const VIEWPORT_GUTTER = 12;

export default function UserMenu({
  compact = false,
  mobile = false,
  placement,
  className = "",
}: UserMenuProps) {
  const router = useRouter();
  const { user, logout } = useAuth();
  const { t, fontClass } = useLanguage();
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const pendingMenuFocusRef = useRef<PendingMenuFocus>(null);
  const [mounted, setMounted] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);
  const expanded = !compact && !mobile;
  const resolvedPlacement = placement ?? (mobile ? "bottom" : "top");

  useEffect(() => {
    setMounted(true);
  }, []);

  const closeMenu = useCallback((restoreFocus = false) => {
    setMenuOpen(false);
    setMenuPosition(null);
    pendingMenuFocusRef.current = null;
    if (restoreFocus) {
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    }
  }, []);

  const updateMenuPosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) {
      return;
    }

    const triggerRect = trigger.getBoundingClientRect();
    const menuHeight = menuRef.current?.offsetHeight ?? (user?.role === "admin" ? 128 : 88);
    const menuWidth = menuRef.current?.offsetWidth ?? MENU_WIDTH;
    const desiredLeft = mobile ? triggerRect.right - menuWidth : triggerRect.left;
    const maxLeft = Math.max(VIEWPORT_GUTTER, window.innerWidth - menuWidth - VIEWPORT_GUTTER);
    const left = Math.min(Math.max(desiredLeft, VIEWPORT_GUTTER), maxLeft);
    const below = triggerRect.bottom + 8;
    const above = triggerRect.top - menuHeight - 8;
    const preferredTop = resolvedPlacement === "bottom"
      ? (below + menuHeight <= window.innerHeight - VIEWPORT_GUTTER ? below : above)
      : (above >= VIEWPORT_GUTTER ? above : below);
    const maxTop = Math.max(VIEWPORT_GUTTER, window.innerHeight - menuHeight - VIEWPORT_GUTTER);
    const top = Math.min(Math.max(preferredTop, VIEWPORT_GUTTER), maxTop);

    setMenuPosition((current) => (
      current?.left === left && current.top === top ? current : { left, top }
    ));
  }, [mobile, resolvedPlacement, user?.role]);

  useEffect(() => {
    if (!menuOpen || !mounted) {
      return;
    }

    updateMenuPosition();
    const frame = window.requestAnimationFrame(updateMenuPosition);

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        closeMenu();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMenu(true);
      }
    };

    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeMenu, menuOpen, mounted, updateMenuPosition]);

  useEffect(() => {
    if (!menuOpen || !menuPosition || !pendingMenuFocusRef.current) {
      return;
    }

    const items = menuRef.current?.querySelectorAll<HTMLElement>("[role='menuitem']");
    if (!items?.length) {
      return;
    }

    const target = pendingMenuFocusRef.current === "last" ? items[items.length - 1] : items[0];
    pendingMenuFocusRef.current = null;
    target.focus();
  }, [menuOpen, menuPosition]);

  const openMenu = (focus: PendingMenuFocus = null) => {
    pendingMenuFocusRef.current = focus;
    setMenuOpen(true);
  };

  const handleTriggerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      openMenu("first");
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      openMenu("last");
    }
  };

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Tab") {
      closeMenu();
      return;
    }

    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      return;
    }

    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>("[role='menuitem']") ?? [],
    );
    if (items.length === 0) {
      return;
    }

    event.preventDefault();
    const currentIndex = items.indexOf(document.activeElement as HTMLElement);
    let nextIndex = 0;
    if (event.key === "End") {
      nextIndex = items.length - 1;
    } else if (event.key === "ArrowUp") {
      nextIndex = currentIndex <= 0 ? items.length - 1 : currentIndex - 1;
    } else if (event.key === "ArrowDown") {
      nextIndex = currentIndex === items.length - 1 ? 0 : currentIndex + 1;
    }
    items[nextIndex].focus();
  };

  const openSettings = () => {
    closeMenu();
    setSettingsOpen(true);
  };

  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  const handleSignOut = async () => {
    if (signingOut) {
      return;
    }

    closeMenu();
    setSigningOut(true);
    try {
      await logout();
      toast.success(t("notifications.signOutSuccess"));
      router.replace("/");
    } catch (error) {
      console.error("Sign out failed:", error);
      toast.error(t("notifications.signOutError"));
      setSigningOut(false);
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    }
  };

  if (!user) {
    return null;
  }

  const menuItemClass = "group flex min-h-10 w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-[#e7dcc2] outline-none transition-colors hover:bg-[#302a25] hover:text-[#f6d99a] focus-visible:bg-[#302a25] focus-visible:text-[#f6d99a]";

  const menu = mounted && menuOpen && menuPosition
    ? createPortal(
      <div
        ref={menuRef}
        id={menuId}
        role="menu"
        aria-label={t("userMenu.menuLabel")}
        onKeyDown={handleMenuKeyDown}
        className={`fixed z-[110] w-52 overflow-hidden rounded-md border border-[#665442] bg-[#1d1a18] py-1 shadow-[0_18px_45px_rgba(0,0,0,0.48)] ${fontClass}`}
        style={{ left: menuPosition.left, top: menuPosition.top }}
      >
        <button
          type="button"
          role="menuitem"
          onClick={openSettings}
          className={menuItemClass}
        >
          <Settings size={16} className="shrink-0 text-[#c89b55]" />
          <span className="min-w-0 flex-1 truncate">{t("userMenu.settings")}</span>
        </button>

        {user.role === "admin" && (
          <Link
            href="/admin"
            role="menuitem"
            onClick={() => closeMenu()}
            className={menuItemClass}
          >
            <ShieldCheck size={16} className="shrink-0 text-[#c89b55]" />
            <span className="min-w-0 flex-1 truncate text-[#e7dcc2] transition-colors group-hover:text-[#f6d99a] group-focus-visible:text-[#f6d99a]">
              {t("userMenu.adminPanel")}
            </span>
          </Link>
        )}

        <button
          type="button"
          role="menuitem"
          onClick={() => void handleSignOut()}
          disabled={signingOut}
          className={`${menuItemClass} text-[#d8b7a7] hover:bg-red-950/20 hover:text-[#efc0ac] focus-visible:bg-red-950/20 focus-visible:text-[#efc0ac] disabled:cursor-wait disabled:opacity-60`}
        >
          {signingOut ? (
            <LoaderCircle size={16} className="shrink-0 animate-spin" />
          ) : (
            <LogOut size={16} className="shrink-0" />
          )}
          <span className="min-w-0 flex-1 truncate">{t("userMenu.signOut")}</span>
        </button>
      </div>,
      document.body,
    )
    : null;

  return (
    <>
      <div ref={rootRef} className={`relative min-w-0 ${className}`}>
        <button
          ref={triggerRef}
          type="button"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-controls={menuOpen ? menuId : undefined}
          aria-label={`${t("userMenu.openMenu")}: ${user.name}`}
          title={user.name}
          onClick={() => (menuOpen ? closeMenu() : openMenu())}
          onKeyDown={handleTriggerKeyDown}
          className={`group flex min-w-0 items-center border border-[#534741]/70 bg-[#1d1a18] text-left text-[#f4e8c1] shadow-inner shadow-black/30 outline-none transition-all hover:border-[#826a4e] hover:bg-[#28231f] focus-visible:border-[#d0a45f] focus-visible:ring-2 focus-visible:ring-amber-500/25 ${expanded ? "h-11 w-full gap-2.5 rounded-md px-2.5" : `${mobile ? "h-10 w-10" : "h-9 w-9"} justify-center rounded-md`}`}
        >
          <span className={`flex shrink-0 items-center justify-center rounded-md border border-[#665442] bg-[#151311] text-[#e1b765] transition-colors group-hover:text-[#ffd27b] ${expanded ? "h-8 w-8" : `${mobile ? "h-8 w-8" : "h-7 w-7"}`}`}>
            <UserAvatar iconSize={expanded || mobile ? 17 : 15} />
          </span>

          {expanded && (
            <>
              <span className={`min-w-0 flex-1 ${fontClass}`}>
                <span className="block truncate text-sm text-[#f4e8c1]">{user.name}</span>
              </span>
              <ChevronDown
                size={15}
                className={`shrink-0 text-[#94816b] transition-transform ${menuOpen ? "rotate-180" : ""}`}
              />
            </>
          )}
        </button>
      </div>

      {menu}
      <UserSettingsModal isOpen={settingsOpen} onClose={closeSettings} />
    </>
  );
}
