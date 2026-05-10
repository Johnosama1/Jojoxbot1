import { useState, useEffect } from "react";

type Listener = (open: boolean) => void;
const listeners: Listener[] = [];
let _open = false;

export function setWinModalOpen(open: boolean) {
  _open = open;
  listeners.forEach(fn => fn(open));
}

export function useWinModalOpen(): boolean {
  const [open, setOpen] = useState(_open);
  useEffect(() => {
    listeners.push(setOpen);
    return () => {
      const i = listeners.indexOf(setOpen);
      if (i > -1) listeners.splice(i, 1);
    };
  }, []);
  return open;
}
