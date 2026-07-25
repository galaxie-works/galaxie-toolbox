import rudder from "@/assets/lottie/rudder.json";
import ship from "@/assets/lottie/ship.json";
import walkieTalkie from "@/assets/lottie/walkie-talkie.json";
import astronaut from "@/assets/lottie/astronaut.json";

import { LottieIcon } from "./lottie-icon";

/** Ícone do Control room — leme (rudder). Anima no hover. */
export function RudderIcon({ className }: { className?: string }) {
  return <LottieIcon data={rudder} className={className} />;
}

/** Ícone do Cruiser (navegador) — nave (ship). Anima no hover. */
export function ShipIcon({ className }: { className?: string }) {
  return <LottieIcon data={ship} className={className} />;
}

/** Ícone do Comms — walkie-talkie. Anima no hover. */
export function WalkieTalkieIcon({ className }: { className?: string }) {
  return <LottieIcon data={walkieTalkie} className={className} />;
}

/** Ícone do Astro — astronauta. Anima no hover. */
export function AstronautIcon({ className }: { className?: string }) {
  return <LottieIcon data={astronaut} className={className} />;
}
