import splashVideo from "@/assets/splash-animation.mp4";

/**
 * Splash de boot (#164). Renderiza APENAS na janela Tauri dedicada
 * `splashscreen` (400×400, `transparent:false`, sem bordas) — quem decide isso é
 * o `main.tsx`, pelo label da janela.
 *
 * A abordagem NÃO depende de transparência de janela (no Windows ela não é
 * honrada de forma confiável e a splash acabava um QUADRADO opaco). Em vez
 * disso: a janela inteira (400×400) é pintada de #171A30 e, por cima, um DIV
 * circular também #171A30 (`border-radius:1024px` + `overflow:hidden`) recorta o
 * vídeo em círculo. Como o círculo e a janela têm a MESMA cor, os cantos do
 * quadrado se fundem no fundo e o usuário vê só o círculo com a animação — sem
 * emenda visível e sem depender de transparência.
 *
 * O vídeo preenche o círculo como um fundo: `object-fit:cover` +
 * `object-position:center center` (preenche e recorta, centralizado — NÃO
 * `contain`), ocupando 100%×100% do DIV, posicionado de forma absoluta.
 *
 * Cor fixa #171A30 de propósito (não segue o tema): é a identidade do splash,
 * casada com o fundo do vídeo.
 */
export function SplashScreen() {
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
          loop
          playsInline
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
