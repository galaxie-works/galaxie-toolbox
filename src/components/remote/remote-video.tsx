// #687 (Remote S4-UI): render do vídeo do host (controller-only). Recebe cada
// access unit H.264 raw (header 17 bytes + Annex-B) via `alimentar`, decodifica
// com WebCodecs (`VideoDecoder`) e desenha o `VideoFrame` no canvas. A tela
// (`remote.tsx`) chama `alimentar` a cada quadro que chega no canal de vídeo do
// wiring (`onVideo` do `iniciarSessaoRemota`).
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

import { parseQuadroVideo } from "@/lib/remote";
import { useIdioma } from "@/lib/idioma";

/** API imperativa exposta à tela: alimenta o decoder com um quadro raw. */
export interface RemoteVideoHandle {
  alimentar(buf: Uint8Array): void;
}

interface RemoteVideoProps {
  className?: string;
}

function suporteWebCodecs(): boolean {
  return (
    typeof window !== "undefined" &&
    "VideoDecoder" in window &&
    "EncodedVideoChunk" in window
  );
}

export const RemoteVideo = forwardRef<RemoteVideoHandle, RemoteVideoProps>(
  function RemoteVideo({ className }, ref) {
    const { t } = useIdioma();
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const decoderRef = useRef<VideoDecoder | null>(null);
    // `configurado` = já chamamos decoder.configure (no 1º keyframe). `viuKeyframe`
    // = já recebemos um keyframe (antes dele, todo delta é descartado — o decoder
    // não tem referência e mostraria lixo/erro).
    const configuradoRef = useRef(false);
    const viuKeyframeRef = useRef(false);
    const [suportado] = useState(suporteWebCodecs);

    function desenhar(frame: VideoFrame): void {
      const canvas = canvasRef.current;
      if (!canvas) {
        frame.close();
        return;
      }
      // Casa o buffer do canvas com o tamanho de exibição do frame (uma vez por
      // mudança de resolução — barato quando não muda).
      if (canvas.width !== frame.displayWidth) canvas.width = frame.displayWidth;
      if (canvas.height !== frame.displayHeight) {
        canvas.height = frame.displayHeight;
      }
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.drawImage(frame, 0, 0, canvas.width, canvas.height);
      frame.close();
    }

    function resetar(): void {
      configuradoRef.current = false;
      viuKeyframeRef.current = false;
      const dec = decoderRef.current;
      decoderRef.current = null;
      if (dec && dec.state !== "closed") {
        try {
          dec.close();
        } catch {
          /* já fechando: ignora */
        }
      }
    }

    function garantirDecoder(): VideoDecoder | null {
      if (!suportado) return null;
      if (decoderRef.current) return decoderRef.current;
      const dec = new VideoDecoder({
        output: (frame) => desenhar(frame),
        // Erro do decoder (config incompatível, stream corrompido): zera tudo e
        // espera o próximo keyframe pra reconfigurar do zero.
        error: () => resetar(),
      });
      decoderRef.current = dec;
      return dec;
    }

    useImperativeHandle(
      ref,
      (): RemoteVideoHandle => ({
        alimentar(buf) {
          if (!suportado) return;
          const quadro = parseQuadroVideo(buf);
          if (!quadro) return;
          // Antes do 1º keyframe: descarta deltas (nada pra referenciar).
          if (!viuKeyframeRef.current && !quadro.keyframe) return;

          const dec = garantirDecoder();
          if (!dec) return;

          if (!configuradoRef.current) {
            // Configura só no keyframe (o SPS/PPS vem no access unit do keyframe).
            if (!quadro.keyframe) return;
            // TODO(#687): `avc1.42E01E` = Baseline 3.0 — chute inicial. O perfil/
            // nível REAIS dependem do encoder do host (runtime-tuned); dá pra
            // parsear o SPS do keyframe pra montar o codec string exato depois.
            dec.configure({ codec: "avc1.42E01E" });
            configuradoRef.current = true;
          }
          viuKeyframeRef.current = true;

          try {
            dec.decode(
              new EncodedVideoChunk({
                type: quadro.keyframe ? "key" : "delta",
                timestamp: quadro.timestampUs,
                data: quadro.annexB,
              }),
            );
          } catch {
            // decode síncrono pode lançar se o decoder caiu entre frames: reseta.
            resetar();
          }
        },
      }),
      [suportado],
    );

    // Fecha o decoder ao desmontar (libera os recursos do codec).
    useEffect(() => resetar, []);

    if (!suportado) {
      return (
        <div className="grid h-full w-full place-items-center bg-black p-6 text-center text-sm text-muted-foreground">
          {t.remote.codecNaoSuportado}
        </div>
      );
    }

    return <canvas ref={canvasRef} className={className} />;
  },
);
