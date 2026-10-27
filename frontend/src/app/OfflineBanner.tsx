import { useEffect, useState } from "react";

/** Hors ligne : l'interface reste affichée, mais les données ne sont plus mises à jour. */
export function OfflineBanner() {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const update = () => { setOnline(navigator.onLine); };
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  if (online) return null;
  return (
    <p className="offline-banner" role="status">
      Hors ligne : les dernières données affichées peuvent ne pas être à jour, et rien ne sera enregistré.
    </p>
  );
}
