export interface UserSessionState {
  isLoggedIn: boolean;
  username: string;
  userId: string;
}

export const USER_SESSION_EVENT = "narratium:user-session-change";

const isBrowser = () => typeof window !== "undefined";

const createDefaultState = (): UserSessionState => ({
  isLoggedIn: false,
  username: "",
  userId: "",
});

const createUserId = () => Math.floor(Math.random() * 10000).toString();

export const getStoredUserSession = (): UserSessionState => {
  if (!isBrowser()) {
    return createDefaultState();
  }

  return {
    isLoggedIn: window.localStorage.getItem("isLoggedIn") === "true",
    username: window.localStorage.getItem("username") || "",
    userId: window.localStorage.getItem("userId") || "",
  };
};

const dispatchUserSessionChange = (state: UserSessionState) => {
  if (!isBrowser()) {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<UserSessionState>(USER_SESSION_EVENT, {
      detail: state,
    }),
  );
};

export const persistUserSession = (username: string): UserSessionState => {
  if (!isBrowser()) {
    return createDefaultState();
  }

  const normalizedUsername = username.trim();
  const userId = window.localStorage.getItem("userId") || createUserId();
  const nextState: UserSessionState = {
    isLoggedIn: true,
    username: normalizedUsername,
    userId,
  };

  window.localStorage.setItem("username", normalizedUsername);
  window.localStorage.setItem("userId", userId);
  window.localStorage.setItem("isLoggedIn", "true");
  dispatchUserSessionChange(nextState);

  return nextState;
};

export const clearUserSession = (): UserSessionState => {
  if (!isBrowser()) {
    return createDefaultState();
  }

  window.localStorage.removeItem("isLoggedIn");
  window.localStorage.removeItem("username");
  window.localStorage.removeItem("userId");

  const nextState = createDefaultState();
  dispatchUserSessionChange(nextState);
  return nextState;
};

export const subscribeToUserSession = (
  callback: (state: UserSessionState) => void,
) => {
  if (!isBrowser()) {
    return () => undefined;
  }

  const emit = () => callback(getStoredUserSession());

  const handleStorage = (event: StorageEvent) => {
    if (event.storageArea !== window.localStorage) {
      return;
    }

    if (!event.key || ["isLoggedIn", "username", "userId"].includes(event.key)) {
      emit();
    }
  };

  const handleCustomEvent = () => emit();

  window.addEventListener("storage", handleStorage);
  window.addEventListener(USER_SESSION_EVENT, handleCustomEvent as EventListener);
  emit();

  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(USER_SESSION_EVENT, handleCustomEvent as EventListener);
  };
};
