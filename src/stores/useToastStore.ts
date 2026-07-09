import { create } from 'zustand';

interface ToastEntry {
  id: string;
  message: string;
}

interface ToastState {
  toast: ToastEntry | null;
  showToast: (message: string) => void;
  dismissToast: (id: string) => void;
}

export const useToastStore = create<ToastState>((set, get) => ({
  toast: null,
  showToast: (message) => {
    set({
      toast: {
        id: crypto.randomUUID(),
        message,
      },
    });
  },
  dismissToast: (id) => {
    const current = get().toast;

    if (current?.id === id) {
      set({ toast: null });
    }
  },
}));
