import splashVideo from "@/assets/splash-animation.mp4";

/**
 * Splash de boot (#164). Renderiza APENAS na janela Tauri dedicada
 * `splashscreen` (400×400, `transparent:true`, sem bordas) — quem decide isso é
 * o `main.tsx`, pelo label da janela.
 *
 * Círculo FLUTUANTE de verdade: a janela é transparente (os cantos deixam ver o
 * desktop — no Windows isso só composita porque o Rust aplica `window-vibrancy`
 * no setup; o `transparent:true` do Tauri sozinho renderizaria um quadrado). O
 * wrapper e o <html>/<body>/#root ficam transparentes; SÓ este DIV circular tem
 * fundo #171A30 (`border-radius:1024px` + `overflow:hidden`), então vê-se apenas
 * o círculo escuro com a animação, flutuando sobre a tela.
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
        background: "transparent",
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
