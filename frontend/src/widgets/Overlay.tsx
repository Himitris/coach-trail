import { createPortal } from "react-dom";
import type { ReactNode } from "react";

/**
 * Fenêtre modale rendue dans <body> : les cadres de la grille sont déplacés par `transform`, ce qui
 * ferait de `position: fixed` une position relative au cadre au lieu de l'écran.
 */
export function Overlay({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  return createPortal(
    <div className="overlay" onClick={onClose}>
      {children}
    </div>,
    document.body,
  );
}
