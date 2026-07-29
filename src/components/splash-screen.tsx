import { useRef } from "react";
import splashVideo from "@/assets/splash-animation.mp4";
import { EVENTO_VIDEO_SPLASH } from "@/lib/splash";

/**
 * Splash de boot (#164). Renderiza APENAS na janela Tauri dedicada
 * `splashscreen` (400×400, `transparent:false`, sem bordas) — quem decide isso é
 * o `main.tsx`, pelo label da janela.
 *
 * Círculo FLUTUANTE de verdade: a janela é OPACA e quem faz o círculo é o
 * `SetWindowRgn` (região elíptica do GDI) no Rust — o OS recorta a janela num
 * círculo, os cantos deixam de existir e vê-se o desktop atrás, sem depender de
 * transparência de janela (não-confiável no Windows). Por isso o wrapper e o
 * <html>/<body>/#root são #171A30 (identidade do splash, casada com o fundo do
 * vídeo): tudo que sobra dentro do círculo recortado é essa cor. O `border-
 * radius:1024px` do DIV abaixo é belt-and-suspenders (o recorte real é o do OS).
 *
 * O vídeo preenche o círculo como um fundo: `object-fit:cover` +
 * `object-position:center center` (preenche e recorta, centralizado — NÃO
 * `contain`), ocupando 100%×100% do DIV, posicionado de forma absoluta.
 *
 * Gate de tempo (#164): o vídeo toca UMA vez (`loop=false`). Quando termina
 * (`onEnded`), a splash EMITE `EVENTO_VIDEO_SPLASH` para a janela `main`, que só
 * revela o app quando `bootPronto && videoPronto` — ou seja, a animação sempre
 * roda inteira antes do app aparecer. Se o vídeo falhar (`onError`) ou o evento
 * `ended` nunca disparar (stall de codec), um fallback de tempo — duração + 3s,
 * ou fixo se a duração for desconhecida — emite mesmo assim, para nunca travar.
 */
export function SplashScreen() {
  const jaSinalizou = useRef(false);
  const fallbackId = useRef<number | null>(null);

  /**
   * Avisa a `main` (uma única decisão) que a animação acabou. Reenvia uma vez
   * ~0,9s depois como seguro contra corrida: se a `main` registrou o `listen` um
   * instante após a splash emitir, o reenvio a alcança. `setVideoPronto(true)` na
   * main é idempotente, então repetir é inofensivo.
   */
  const sinalizarFim = () => {
    if (jaSinalizou.current) return;
    jaSinalizou.current = true;
    if (fallbackId.current != null) {
      clearTimeout(fallbackId.current);
      fallbackId.current = null;
    }
    const emitir = async () => {
      try {
        const { emit } = await import("@tauri-apps/api/event");
        await emit(EVENTO_VIDEO_SPLASH);
      } catch {
        // Fora do Tauri / API indisponível: a main tem o longstop como rede.
      }
    };
    void emitir();
    window.setTimeout(() => void emitir(), 900);
  };

  /** Arma o fallback de tempo uma vez (idempotente). */
  const armarFallback = (segundos: number) => {
    if (fallbackId.current != null || jaSinalizou.current) return;
    fallbackId.current = window.setTimeout(sinalizarFim, segundos * 1000);
  };

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        background: "#171A30",
        display: "grid",
        placeItems: "center",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "relative",
          width: "400px",
          height: "400px",
          borderRadius: "1024px",
          overflow: "hidden",
          background: "#171A30",
        }}
      >
        <video
          src={splashVideo}
          autoPlay
          muted
          playsInline
          preload="auto"
          onEnded={sinalizarFim}
          onError={sinalizarFim}
          onLoadedMetadata={(e) => {
            const dur = e.currentTarget.duration;
            // ended deve disparar na duração; o fallback cobre o caso de ele não
            // vir. Sem duração válida (Infinity/NaN), usa um fixo folgado.
            const segundos =
              Number.isFinite(dur) && dur > 0 ? dur + 3 : 15;
            armarFallback(segundos);
          }}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            objectPosition: "center center",
            display: "block",
          }}
        />
      </div>
    </div>
  );
}
