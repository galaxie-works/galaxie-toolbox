import { ChevronDownIcon, CheckIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Frame,
  FrameDescription,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from "@/components/reui/frame";
import { VolumeIcon } from "@/components/ui/volume";
import { AudioLinesIcon } from "@/components/ui/audio-lines";
import { PlayIcon } from "@/components/ui/play";

import { useIdioma } from "@/lib/idioma";
import { usePersistedState } from "@/lib/persist";
import {
  CHAVE_NOTIFICACOES,
  PREF_PADRAO,
  SONS,
  VALOR_SEM_SOM,
  somPorId,
  tocarSom,
  type EscopoNotificacao,
  type PreferenciasNotificacao,
} from "@/lib/sons-notificacao";

/**
 * Settings > Notificações (#48).
 *
 * Frame (reui `c-frame-3`) com 3 stacked panels — E-mails recebidos, Mensagens
 * recebidas e Problemas de sincronização — cada um com o seletor de som
 * (reui `c-button-group-7`, variante Radix `asChild`) alinhado à direita.
 * A preferência persiste em localStorage sob `bridge.notificacoes`.
 */
export function NotificacoesSettings() {
  const { t } = useIdioma();
  const [prefs, setPrefs] = usePersistedState<PreferenciasNotificacao>(
    CHAVE_NOTIFICACOES,
    PREF_PADRAO
  );

  const n = t.notificacoes;

  const escopos: {
    chave: EscopoNotificacao;
    titulo: string;
    descricao: string;
  }[] = [
    { chave: "emailRecebido", titulo: n.emailTitulo, descricao: n.emailDescricao },
    {
      chave: "mensagemRecebida",
      titulo: n.mensagemTitulo,
      descricao: n.mensagemDescricao,
    },
    {
      chave: "sincronizacao",
      titulo: n.sincronizacaoTitulo,
      descricao: n.sincronizacaoDescricao,
    },
  ];

  const definir = (chave: EscopoNotificacao, valor: string) =>
    setPrefs((atual) => ({ ...atual, [chave]: valor }));

  return (
    <TooltipProvider>
      <Frame className="w-full" stacked>
        <FrameHeader>
          <FrameTitle>{n.titulo}</FrameTitle>
          <FrameDescription>{n.subtitulo}</FrameDescription>
        </FrameHeader>
        {escopos.map((e) => (
          <FramePanel key={e.chave}>
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold">{e.titulo}</h3>
                <p className="text-sm text-muted-foreground">{e.descricao}</p>
              </div>
              <SeletorSom
                valor={prefs[e.chave]}
                onChange={(v) => definir(e.chave, v)}
                rotuloSemSom={n.semSom}
                rotuloSons={n.sonsDisponiveis}
                rotuloPreview={n.preview}
              />
            </div>
          </FramePanel>
        ))}
      </Frame>
    </TooltipProvider>
  );
}

interface SeletorSomProps {
  valor: string;
  onChange: (valor: string) => void;
  rotuloSemSom: string;
  rotuloSons: string;
  rotuloPreview: string;
}

/** ButtonGroup: dropdown de sons (gatilho volume) + botão Play com tooltip "Preview". */
function SeletorSom({
  valor,
  onChange,
  rotuloSemSom,
  rotuloSons,
  rotuloPreview,
}: SeletorSomProps) {
  const selecionado = somPorId(valor);
  const rotulo = selecionado ? selecionado.nome : rotuloSemSom;
  const semSelecao = valor === VALOR_SEM_SOM;

  return (
    <ButtonGroup className="shrink-0">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="w-56 justify-start gap-2">
            <VolumeIcon size={16} aria-hidden="true" />
            <span className="truncate">{rotulo}</span>
            <ChevronDownIcon
              aria-hidden="true"
              className="ml-auto size-3.5 opacity-60"
            />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuGroup>
            <DropdownMenuLabel>{rotuloSons}</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => onChange(VALOR_SEM_SOM)}>
              <VolumeIcon size={16} aria-hidden="true" />
              <span>{rotuloSemSom}</span>
              {semSelecao && (
                <CheckIcon
                  aria-hidden="true"
                  className="ml-auto size-3.5 text-primary"
                />
              )}
            </DropdownMenuItem>
            {SONS.map((som) => (
              <DropdownMenuItem
                key={som.id}
                onSelect={() => onChange(som.id)}
              >
                <AudioLinesIcon size={16} aria-hidden="true" />
                <span>{som.nome}</span>
                {valor === som.id && (
                  <CheckIcon
                    aria-hidden="true"
                    className="ml-auto size-3.5 text-primary"
                  />
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            aria-label={rotuloPreview}
            disabled={semSelecao}
            onClick={() => tocarSom(valor)}
          >
            <PlayIcon size={16} aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{rotuloPreview}</TooltipContent>
      </Tooltip>
    </ButtonGroup>
  );
}
