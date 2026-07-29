import splashVideo from "@/assets/splash-animation.mp4";

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
