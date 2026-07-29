import splashVideo from "@/assets/splash-animation.mp4";

/**
 * Splash de boot (#164). Renderiza APENAS na janela Tauri dedicada
 * `splashscreen` (400×400, `transparent:true`, sem bordas) — quem decide isso é
 * o `main.tsx`, pelo label da janela. Como a janela é transparente, só o círculo
 * abaixo aparece na tela; os cantos ficam vazados.
 *
 * O vídeo é retrato 9:16 e entra INTEIRO (sem crop): fica centralizado com a
 * altura do círculo (`height:100%`, `width:auto` → ~225px). O círculo
 * (`border-radius:50%` + `overflow:hidden`, `background:#171A30`) recorta os
 * cantos do retângulo do vídeo; como o fundo do próprio vídeo também é #171A30,
 * a emenda some e vê-se um círculo escuro com a animação central.
 *
 * Cor fixa #171A30 de propósito (não segue o tema): é a identidade do splash,
 * casada com o fundo do vídeo. Trocar de "só o círculo" para "tela toda" seria
 * mudar a config da janela `splashscreen`, não este componente.
 */
export function SplashScreen() {
  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        borderRadius: "50%",
        overflow: "hidden",
        background: "#171A30",
        display: "grid",
        placeItems: "center",
      }}
    >
      <video
        src={splashVideo}
        autoPlay
        muted
        loop
        playsInline
        style={{
          height: "100%",
          width: "auto",
          display: "block",
          background: "#171A30",
        }}
      />
    </div>
  );
}
