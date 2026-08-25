// #687 (Remote S4-UI): tela GALAXIE Remote — sessão assistida (host + controller).
// Orquestra o signaling S0 (`criarSinalizadorWs`) + o wiring da sessão (`remote.ts`)
// + o render de vídeo (`RemoteVideo`) + a captura de input (`input-mapa`). A
// máquina de estado da UI mora aqui; o transporte/WebRTC é do Rust.
//
// Fluxo:
//  - HOST ("preciso de suporte"): abre o WS → cria sessão assistida → mostra o
//    código → no pareamento inicia a sessão como host (só envia tela + recebe
//    input); relaia os signals dos dois lados.
//  - CONTROLLER ("vou dar suporte"): abre o WS → resgata o código → no pareamento
//    inicia como controller (recebe vídeo, envia input); renderiza a viewport.
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  Copy,
  LifeBuoy,
  Maximize,
  Monitor,
  MonitorUp,
} from "lucide-react";

import SoftBlurIn from "@/components/smoothui/soft-blur-in";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import {
  RemoteVideo,
  type RemoteVideoHandle,
} from "@/components/remote/remote-video";
import {
  eventoMouseBotao,
  eventoMouseMove,
  eventoScroll,
  eventoTecla,
  posNoFrame,
  type Retangulo,
} from "@/components/remote/input-mapa";
import {
  encerrarSessao,
  enviarInput,
  iniciarSessaoRemota,
  sinalizarSessao,
  type RemoteSessionEvent,
  type RemoteSessionState,
  type ScreenInfo,
} from "@/lib/remote";
import {
  criarSinalizadorWs,
  endpointSignaling,
  type ErrorCodeS0,
  type IceServer,
  type SinalizadorS0,
} from "@/lib/remote-signaling";
import {
  criarAgendadorRenovacao,
  type AgendadorRenovacao,
} from "@/lib/remote-renovacao";
import { useIdioma } from "@/lib/idioma";

type Modo = "escolha" | "host" | "controller";

export function RemoteScreen() {
  const { t } = useIdioma();

  const [modo, setModo] = useState<Modo>("escolha");
  // Estado da sessão de transporte (null = ainda não iniciada). O `conectandoS0`
  // cobre a janela ANTES da sessão: handshake do WS + create/redeem do código.
  const [estado, setEstado] = useState<RemoteSessionState | null>(null);
  const [conectandoS0, setConectandoS0] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // Host: código a exibir. Controller: código digitado.
  const [codigo, setCodigo] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [codigoInput, setCodigoInput] = useState("");
  const [screenInfo, setScreenInfo] = useState<ScreenInfo | null>(null);
  // #1148: renovação da credencial TURN em risco (a renovação não voltou na
  // janela; a sessão relayed pode cair). Só aparece se o relay estiver em uso.
  const [renovacaoEmRisco, setRenovacaoEmRisco] = useState(false);

  // Refs de sessão (não disparam render; lidos nos callbacks assíncronos).
  const sinalizadorRef = useRef<SinalizadorS0 | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const peerIdRef = useRef<string | null>(null);
  const iceServersRef = useRef<IceServer[]>([]);
  const renovadorRef = useRef<AgendadorRenovacao | null>(null);
  const videoRef = useRef<RemoteVideoHandle | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);

  // #1148: monta o agendador de renovação da credencial TURN. A fatia 1 do
  // servidor responde `renew_ice_servers` → `ice_servers_renewed` (ea15b87); aqui
  // o cliente agenda a 3/4 do `expires_at` e, ao receber a credencial nova,
  // atualiza `iceServersRef`. O APPLY na PeerConnection viva (str0m/Rust) é a
  // fatia BE companheira do #1148 — um comando Tauri (ex. `remote_session_renew_ice`)
  // que reconfigura os ICE servers + ICE restart preservando a PC. Enquanto ele
  // não existe, guardamos a credencial nova (usada por qualquer (re)início de
  // sessão) e a str0m PC viva ainda não é reconfigurada — sem inventar `invoke`.
  function iniciarRenovador(sinal: SinalizadorS0, iceServers: IceServer[]): void {
    renovadorRef.current?.parar();
    const ag = criarAgendadorRenovacao({
      agoraUnixSeconds: () => Math.floor(Date.now() / 1000),
      agendar: (fn, ms) => window.setTimeout(fn, ms),
      cancelar: (id) => window.clearTimeout(id),
      pedirRenovacao: () => sinal.renovarIceServers(),
      aplicar: (ice) => {
        iceServersRef.current = ice;
        // TODO(#1148 fatia BE): comando Tauri que aplica `ice` na str0m PC viva
        // (reconfigure + ICE restart, PC preservada). Sem ele, a renovação é
        // guardada mas não reconfigura a sessão relayed em curso.
      },
      aoAvisar: (emRisco) => setRenovacaoEmRisco(emRisco),
    });
    renovadorRef.current = ag;
    ag.iniciar(iceServers);
  }

  // --- Ciclo de vida da sessão ---------------------------------------------

  function limpar(): void {
    renovadorRef.current?.parar();
    renovadorRef.current = null;
    setRenovacaoEmRisco(false);
    sinalizadorRef.current = null;
    sessionIdRef.current = null;
    peerIdRef.current = null;
    iceServersRef.current = [];
    setEstado(null);
    setConectandoS0(false);
    setErro(null);
    setCodigo(null);
    setCopiado(false);
    setCodigoInput("");
    setScreenInfo(null);
  }

  function encerrar(): void {
    const id = sessionIdRef.current;
    if (id) void encerrarSessao(id);
    sinalizadorRef.current?.fechar();
    limpar();
    setModo("escolha");
  }

  // Encerra ao desmontar a tela (fecha transporte + WS; solta input preso).
  useEffect(() => {
    return () => {
      const id = sessionIdRef.current;
      if (id) void encerrarSessao(id);
      sinalizadorRef.current?.fechar();
    };
  }, []);

  function traduzErro(code: ErrorCodeS0, message: string): string {
    if (
      code === "invalid_code" ||
      code === "code_expired" ||
      code === "peer_offline"
    ) {
      return t.remote.codigoInvalido;
    }
    return message || t.remote.erroConexao;
  }

  // Eventos JSON da sessão de transporte (comuns aos dois papéis).
  function aoEvento(ev: RemoteSessionEvent): void {
    switch (ev.type) {
      case "state":
        setEstado(ev.state);
        if (ev.state === "error") {
          setErro(ev.message ?? t.remote.erroConexao);
        }
        break;
      case "signal": {
        // Relay: o transporte gerou um signal (SDP/ICE) → manda pro peer via S0.
        const peerId = peerIdRef.current;
        if (peerId) sinalizadorRef.current?.enviarSinal(peerId, ev.signal);
        break;
      }
      case "screen":
        // Geometria do host: usada pra razão de aspecto da viewport (controller).
        setScreenInfo(ev.info);
        break;
      case "stats":
        // TODO(#687): HUD de rtt/bitrate/frames (ev.rttMs/bitrateBps/frames).
        break;
    }
  }

  /** Inicia o wiring da sessão de transporte (host ou controller). */
  async function iniciarSessao(
    role: "host" | "controller",
    peerId: string,
    endpoint: string,
  ): Promise<void> {
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;
    peerIdRef.current = peerId;
    setConectandoS0(false);
    setEstado("connecting");
    try {
      const resp = await iniciarSessaoRemota(
        {
          role,
          sessionId,
          signaling: { endpoint, peerId },
          iceServers: iceServersRef.current,
          capabilities: { screen: true, input: true },
        },
        aoEvento,
        role === "controller"
          ? (buf) => videoRef.current?.alimentar(buf)
          : undefined,
      );
      // #687/#839: no build DEFAULT o backend Remote é `#[cfg(feature="remote")]`
      // OFF → os comandos `remote_*` são stubs que devolvem erro (ou fora do Tauri
      // o wrapper devolve state:"error" sem lançar). Degrada gracioso: mensagem
      // clara de "indisponível neste build" em vez de "connecting" preso.
      if (resp.state === "error") {
        setEstado("error");
        setErro(t.remote.remoteIndisponivel);
      }
    } catch (e) {
      // Rejeição do invoke = comando stubado/ausente (Remote não compilado).
      console.warn(
        "[remote] iniciar sessão falhou (Remote não compilado neste build?):",
        e,
      );
      setEstado("error");
      setErro(t.remote.remoteIndisponivel);
    }
  }

  // --- Host -----------------------------------------------------------------

  async function iniciarHost(): Promise<void> {
    setModo("host");
    setErro(null);
    setConectandoS0(true);
    const sessionId = crypto.randomUUID();
    sessionIdRef.current = sessionId;
    const endpoint = await endpointSignaling();
    const sinal = criarSinalizadorWs(endpoint);
    sinalizadorRef.current = sinal;
    try {
      const { iceServers } = await sinal.conectar({
        onCodigo: (code) => setCodigo(code),
        onPareado: (peerId) => void iniciarSessao("host", peerId, endpoint),
        onSinal: (_peer, s) => {
          const id = sessionIdRef.current;
          if (id) void sinalizarSessao(id, s);
        },
        onIceServersRenovados: (ice) => renovadorRef.current?.aoRenovado(ice),
        onErro: (code, message) => {
          setConectandoS0(false);
          setErro(traduzErro(code, message));
        },
        onFechado: () => {
          // WS caiu: só reflete se a sessão de transporte ainda não assumiu.
          if (!sessionIdRef.current) setErro(t.remote.erroConexao);
        },
      });
      iceServersRef.current = iceServers;
      iniciarRenovador(sinal, iceServers);
      setConectandoS0(false);
      sinal.criarSessao();
    } catch (e) {
      setConectandoS0(false);
      setErro(String(e));
    }
  }

  async function copiarCodigo(): Promise<void> {
    if (!codigo) return;
    try {
      await navigator.clipboard.writeText(codigo);
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 2000);
    } catch {
      /* clipboard indisponível: sem-op (o código segue visível pra copiar à mão) */
    }
  }

  // --- Controller -----------------------------------------------------------

  async function conectarController(): Promise<void> {
    const code = codigoInput.trim();
    if (!code || conectandoS0) return;
    setErro(null);
    setConectandoS0(true);
    const sessionId = crypto.randomUUID();
    sessionIdRef.current = sessionId;
    const endpoint = await endpointSignaling();
    const sinal = criarSinalizadorWs(endpoint);
    sinalizadorRef.current = sinal;
    try {
      const { iceServers } = await sinal.conectar({
        onPareado: (peerId) =>
          void iniciarSessao("controller", peerId, endpoint),
        onSinal: (_peer, s) => {
          const id = sessionIdRef.current;
          if (id) void sinalizarSessao(id, s);
        },
        onIceServersRenovados: (ice) => renovadorRef.current?.aoRenovado(ice),
        onErro: (code, message) => {
          setConectandoS0(false);
          setErro(traduzErro(code, message));
        },
        onFechado: () => {
          if (!sessionIdRef.current) setErro(t.remote.erroConexao);
        },
      });
      iceServersRef.current = iceServers;
      iniciarRenovador(sinal, iceServers);
      sinal.resgatarSessao(code);
    } catch (e) {
      setConectandoS0(false);
      setErro(String(e));
    }
  }

  // --- Captura de input na viewport (controller) ----------------------------

  function retanguloViewport(): Retangulo {
    const r = viewportRef.current?.getBoundingClientRect();
    return {
      left: r?.left ?? 0,
      top: r?.top ?? 0,
      width: r?.width ?? 0,
      height: r?.height ?? 0,
    };
    // #1444: devolve o rect CRU da viewport (inclui as bordas do letterbox); o
    // desconto das bordas — mapear pela área real do frame — mora no `posNoFrame`/
    // `areaFrame` do input-mapa, com a geometria do host (`screenInfo`).
  }

  function enviarEvento(
    ev: ReturnType<typeof eventoMouseMove> | null,
  ): void {
    const id = sessionIdRef.current;
    if (ev && id) void enviarInput(id, ev);
  }

  function telaCheia(): void {
    const el = viewportRef.current;
    if (el && !document.fullscreenElement) void el.requestFullscreen?.();
  }

  // --- Render ---------------------------------------------------------------

  function rotuloEstado(): string {
    switch (estado) {
      case "connecting":
        return t.remote.conectando;
      case "connected":
        return t.remote.sessaoAtiva;
      case "reconnecting":
        return t.remote.reconectando;
      case "ended":
        return t.remote.sessaoEncerrada;
      case "error":
        return erro ?? t.remote.erroConexao;
      default:
        return t.remote.conectando;
    }
  }

  return (
    <div className="flex h-full flex-col gap-4">
      {/* Hero — mesmo padrão das telas full-height (Windows/Arquivos). */}
      <div className="flex shrink-0 items-center gap-3">
        <div
          aria-hidden="true"
          className="flex size-11 items-center justify-center rounded-lg bg-secondary"
        >
          <Monitor className="size-5" />
        </div>
        <h1 className="text-xl font-semibold tracking-tight">
          <SoftBlurIn delay={80} stagger={16}>
            {t.remote.titulo}
          </SoftBlurIn>
        </h1>
      </div>

      <div className="min-h-0 flex-1">
        {/* #1148: renovação da credencial TURN em risco — vale pros dois papéis
            (host e controller), por isso o aviso vive aqui, acima dos painéis. */}
        {renovacaoEmRisco && (
          <p
            role="status"
            className="mb-3 rounded-md bg-yellow-100 px-3 py-2 text-center text-sm text-yellow-900"
          >
            {t.remote.renovacaoEmRisco}
          </p>
        )}
        {modo === "escolha" && (
          <EscolhaModo t={t} onHost={iniciarHost} onController={() => setModo("controller")} />
        )}

        {modo === "host" && (
          <PainelHost
            t={t}
            codigo={codigo}
            copiado={copiado}
            conectando={conectandoS0}
            estado={estado}
            erro={erro}
            rotuloEstado={rotuloEstado()}
            onCopiar={() => void copiarCodigo()}
            onEncerrar={encerrar}
          />
        )}

        {modo === "controller" && (
          <PainelController
            t={t}
            codigoInput={codigoInput}
            conectando={conectandoS0}
            estado={estado}
            erro={erro}
            screenInfo={screenInfo}
            rotuloEstado={rotuloEstado()}
            videoRef={videoRef}
            viewportRef={viewportRef}
            onCodigoInput={setCodigoInput}
            onConectar={() => void conectarController()}
            onEncerrar={encerrar}
            onTelaCheia={telaCheia}
            enviarEvento={enviarEvento}
            retangulo={retanguloViewport}
          />
        )}
      </div>
    </div>
  );
}

type Textos = ReturnType<typeof useIdioma>["t"];

/** Entrada: escolha do papel (host = pede ajuda / controller = dá ajuda). */
function EscolhaModo({
  t,
  onHost,
  onController,
}: {
  t: Textos;
  onHost: () => void;
  onController: () => void;
}) {
  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col justify-center gap-6">
      <h2 className="text-center text-lg font-medium text-muted-foreground">
        {t.remote.escolhaTitulo}
      </h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <CartaoModo
          icone={<MonitorUp className="size-6" />}
          titulo={t.remote.modoHost}
          descricao={t.remote.modoHostDesc}
          onClick={onHost}
        />
        <CartaoModo
          icone={<LifeBuoy className="size-6" />}
          titulo={t.remote.modoController}
          descricao={t.remote.modoControllerDesc}
          onClick={onController}
        />
      </div>
    </div>
  );
}

function CartaoModo({
  icone,
  titulo,
  descricao,
  onClick,
}: {
  icone: React.ReactNode;
  titulo: string;
  descricao: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-start gap-3 rounded-xl border bg-card p-5 text-left shadow-sm transition-colors hover:bg-accent focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <div className="flex size-11 items-center justify-center rounded-lg bg-secondary text-foreground">
        {icone}
      </div>
      <div>
        <div className="font-semibold">{titulo}</div>
        <div className="mt-1 text-sm text-muted-foreground">{descricao}</div>
      </div>
    </button>
  );
}

/** Host: mostra o código de sessão + consentimento; aguarda o peer parear. */
function PainelHost({
  t,
  codigo,
  copiado,
  conectando,
  estado,
  erro,
  rotuloEstado,
  onCopiar,
  onEncerrar,
}: {
  t: Textos;
  codigo: string | null;
  copiado: boolean;
  conectando: boolean;
  estado: RemoteSessionState | null;
  erro: string | null;
  rotuloEstado: string;
  onCopiar: () => void;
  onEncerrar: () => void;
}) {
  const encerrada = estado === "ended" || estado === "error";
  return (
    <div className="mx-auto flex h-full max-w-md flex-col justify-center gap-6">
      <div className="rounded-xl border bg-card p-6 text-center shadow-sm">
        <div className="text-sm font-medium text-muted-foreground">
          {t.remote.seuCodigo}
        </div>

        {conectando && !codigo ? (
          <div className="mt-4 flex items-center justify-center gap-2 text-muted-foreground">
            <Spinner className="size-5" />
            <span>{t.remote.conectando}</span>
          </div>
        ) : codigo ? (
          <>
            <div className="mt-3 font-mono text-4xl font-bold tracking-[0.2em] tabular-nums">
              {codigo}
            </div>
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={onCopiar}
            >
              {copiado ? (
                <>
                  <Check className="size-4" /> {t.remote.codigoCopiado}
                </>
              ) : (
                <>
                  <Copy className="size-4" /> {t.remote.copiarCodigo}
                </>
              )}
            </Button>
          </>
        ) : null}

        {/* Status da sessão / espera pelo peer. */}
        {codigo && (
          <div className="mt-5 flex items-center justify-center gap-2 text-sm text-muted-foreground">
            {estado == null ? (
              <>
                <Spinner className="size-4" />
                <span>{t.remote.aguardandoPeer}</span>
              </>
            ) : (
              <span
                className={
                  estado === "error" ? "text-destructive" : undefined
                }
              >
                {rotuloEstado}
              </span>
            )}
          </div>
        )}
      </div>

      <p className="text-center text-xs text-muted-foreground">
        {t.remote.consentNota}
      </p>

      {erro && !codigo && (
        <p className="text-center text-sm text-destructive">{erro}</p>
      )}

      <div className="flex justify-center">
        <Button
          variant={encerrada ? "outline" : "destructive"}
          onClick={onEncerrar}
        >
          {encerrada ? (
            <>
              <ArrowLeft className="size-4" /> {t.remote.novaSessao}
            </>
          ) : (
            t.remote.encerrar
          )}
        </Button>
      </div>
    </div>
  );
}

/** Controller: digita o código, conecta, e quando conectado controla a tela. */
function PainelController({
  t,
  codigoInput,
  conectando,
  estado,
  erro,
  screenInfo,
  rotuloEstado,
  videoRef,
  viewportRef,
  onCodigoInput,
  onConectar,
  onEncerrar,
  onTelaCheia,
  enviarEvento,
  retangulo,
}: {
  t: Textos;
  codigoInput: string;
  conectando: boolean;
  estado: RemoteSessionState | null;
  erro: string | null;
  screenInfo: ScreenInfo | null;
  rotuloEstado: string;
  videoRef: React.RefObject<RemoteVideoHandle | null>;
  viewportRef: React.RefObject<HTMLDivElement | null>;
  onCodigoInput: (v: string) => void;
  onConectar: () => void;
  onEncerrar: () => void;
  onTelaCheia: () => void;
  enviarEvento: (ev: ReturnType<typeof eventoMouseMove> | null) => void;
  retangulo: () => Retangulo;
}) {
  const conectado = estado === "connected";
  const emSessao = estado != null && estado !== "ended" && estado !== "error";

  // Sessão ativa: viewport de vídeo + barra de controle + captura de input.
  if (emSessao) {
    const aspecto =
      screenInfo && screenInfo.height > 0
        ? `${screenInfo.width} / ${screenInfo.height}`
        : undefined;
    // #1444: geometria do host pra mapear o clique pela ÁREA REAL do frame (não
    // pela viewport, que inclui as bordas do letterbox). `dentroDoFrame` guarda os
    // botões: clique na borda preta não vira evento (não há ponto remoto ali).
    const frameW = screenInfo?.width ?? 0;
    const frameH = screenInfo?.height ?? 0;
    const dentroDoFrame = (e: React.PointerEvent): boolean =>
      posNoFrame(e.clientX, e.clientY, retangulo(), frameW, frameH) !== null;
    return (
      <div className="flex h-full flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-muted-foreground">{rotuloEstado}</span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onTelaCheia}
              disabled={!conectado}
            >
              <Maximize className="size-4" /> {t.remote.telaCheia}
            </Button>
            <Button variant="destructive" size="sm" onClick={onEncerrar}>
              {t.remote.encerrar}
            </Button>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 place-items-center">
          {/* Viewport: recebe foco (tabIndex) e captura mouse/teclado/scroll.
              Coord normalizada 0..1 via input-mapa; down/up explícito. */}
          <div
            ref={viewportRef}
            tabIndex={0}
            style={aspecto ? { aspectRatio: aspecto } : undefined}
            className="relative max-h-full w-full max-w-full overflow-hidden rounded-lg bg-black outline-none ring-1 ring-border focus-visible:ring-2 focus-visible:ring-ring"
            onPointerMove={(e) =>
              enviarEvento(
                eventoMouseMove(e.clientX, e.clientY, retangulo(), frameW, frameH),
              )
            }
            onPointerDown={(e) => {
              e.preventDefault();
              viewportRef.current?.focus();
              // #1444: só emite o botão se o clique cai DENTRO do frame; na borda
              // preta não há ponto remoto. O foco/preventDefault valem sempre.
              if (dentroDoFrame(e)) enviarEvento(eventoMouseBotao(e.button, true));
            }}
            onPointerUp={(e) => {
              e.preventDefault();
              if (dentroDoFrame(e)) enviarEvento(eventoMouseBotao(e.button, false));
            }}
            onContextMenu={(e) => e.preventDefault()}
            // TODO(#687): onWheel é passivo no root do React — o preventDefault
            // pode não segurar o scroll da página; afinar com listener nativo
            // {passive:false} na validação live.
            onWheel={(e) => enviarEvento(eventoScroll(e.deltaX, e.deltaY))}
            onKeyDown={(e) => {
              e.preventDefault();
              enviarEvento(eventoTecla(e.key, true));
            }}
            onKeyUp={(e) => {
              e.preventDefault();
              enviarEvento(eventoTecla(e.key, false));
            }}
          >
            <RemoteVideo
              ref={videoRef}
              className="h-full w-full object-contain"
            />
          </div>
        </div>
      </div>
    );
  }

  // Antes de conectar (ou pós-encerramento): formulário do código.
  return (
    <div className="mx-auto flex h-full max-w-md flex-col justify-center gap-4">
      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <label
          htmlFor="remote-codigo"
          className="text-sm font-medium text-muted-foreground"
        >
          {t.remote.digiteCodigo}
        </label>
        <Input
          id="remote-codigo"
          value={codigoInput}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          className="mt-2 text-center font-mono text-lg tracking-widest"
          onChange={(e) => onCodigoInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onConectar();
          }}
          disabled={conectando}
        />
        <Button
          className="mt-4 w-full"
          onClick={onConectar}
          disabled={conectando || codigoInput.trim().length === 0}
        >
          {conectando ? (
            <>
              <Spinner className="size-4" /> {t.remote.conectando}
            </>
          ) : (
            t.remote.conectar
          )}
        </Button>
        {erro && (
          <p className="mt-3 text-center text-sm text-destructive">{erro}</p>
        )}
      </div>
    </div>
  );
}
