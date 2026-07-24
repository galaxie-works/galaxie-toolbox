import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/reui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatBytes } from "@/lib/utils";
import type { Site } from "@/lib/types";
import {
  CloudDownload,
  CloudOff,
  FileStack,
  Folders,
  HelpCircleIcon,
  SquareActivity,
} from "lucide-react";

export type ModoConfirmacao = "conectar" | "desconectar";

/** Preferencia de "nao perguntar mais" — vale so para conectar. */
const CHAVE_PULAR = "galaxie-pular-confirmacao-conexao";

export function podePularConfirmacao(): boolean {
  return localStorage.getItem(CHAVE_PULAR) === "1";
}

export function gravarPularConfirmacao(pular: boolean) {
  if (pular) localStorage.setItem(CHAVE_PULAR, "1");
  else localStorage.removeItem(CHAVE_PULAR);
}

const fmt = (n: number) => n.toLocaleString("pt-BR");

function Cartao({
  icone,
  titulo,
  descricao,
  valor,
}: {
  icone: React.ReactNode;
  titulo: string;
  descricao: string;
  valor: string;
}) {
  return (
    <div className="border-border flex items-center justify-between rounded-md border border-dashed px-3 py-2.5">
      <div className="flex items-center gap-2.5">
        <div className="bg-background border-border/80 flex size-8 items-center justify-center rounded-md border shadow-xs">
          {icone}
        </div>
        <div className="flex flex-col gap-0.25">
          <span className="text-sm font-medium">{titulo}</span>
          <span className="text-muted-foreground text-xs">{descricao}</span>
        </div>
      </div>
      {/* Metrica, nao status: chip neutro em vez de verde/ambar, que aqui
          sugeriria "aprovado"/"pendente" sem querer. */}
      <Badge variant="secondary" size="lg">
        {valor}
      </Badge>
    </div>
  );
}

export function ConfirmarBiblioteca({
  site,
  modo,
  pular,
  onPularChange,
  onConfirmar,
  onCancelar,
}: {
  site: Site | null;
  modo: ModoConfirmacao;
  pular: boolean;
  onPularChange: (v: boolean) => void;
  onConfirmar: () => void;
  onCancelar: () => void;
}) {
  const conectando = modo === "conectar";
  const desconhecido = "—";

  const cartoes = [
    {
      icone: <Folders className="text-muted-foreground size-4" />,
      titulo: "Pastas",
      descricao: conectando
        ? "Quantidade de pastas na biblioteca"
        : "Pastas que saem do seu Explorer",
      valor: site?.folders != null ? fmt(site.folders) : desconhecido,
    },
    {
      icone: <FileStack className="text-muted-foreground size-4" />,
      titulo: "Arquivos",
      descricao: conectando
        ? "Quantidade de arquivos na biblioteca"
        : "Arquivos que saem do seu Explorer",
      valor: site?.files != null ? fmt(site.files) : desconhecido,
    },
    {
      icone: <SquareActivity className="text-muted-foreground size-4" />,
      titulo: "Peso",
      // De proposito NAO dizemos "espaco que sera liberado": com arquivos sob
      // demanda a maior parte nao ocupa disco, entao prometer espaco livre
      // seria mentira.
      descricao: "Tamanho da biblioteca na nuvem",
      valor: site?.bytes != null ? formatBytes(site.bytes) : desconhecido,
    },
  ];

  return (
    <AlertDialog open={site != null} onOpenChange={(o) => !o && onCancelar()}>
      <AlertDialogContent className="max-w-sm! gap-0 overflow-hidden p-0">
        {/* Cabecalho */}
        <div className="flex flex-col items-center justify-center gap-1.5 px-4 pt-6 pb-5 text-center">
          <AlertDialogMedia
            className={
              conectando
                ? "size-12 rounded-full bg-amber-50 text-amber-600 dark:bg-amber-950 dark:text-amber-400"
                : "size-12 rounded-full bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-400"
            }
          >
            {conectando ? (
              <CloudDownload className="size-6" />
            ) : (
              <CloudOff className="size-6" />
            )}
          </AlertDialogMedia>
          <AlertDialogTitle className="text-base font-semibold">
            {conectando ? "Antes de continuar" : "Remover esta biblioteca?"}
          </AlertDialogTitle>
          <AlertDialogDescription className="p-0 text-sm">
            {conectando ? (
              <>
                Ao habilitar <strong>{site?.name}</strong>, o OneDrive vai
                sincronizar todas as pastas e arquivos dela com a sua máquina.
                Eles aparecem no Explorer, mas só ocupam espaço quando você abre.
              </>
            ) : (
              <>
                A pasta <strong>{site?.name}</strong> sai do seu OneDrive e do
                Explorer, inclusive os arquivos que você baixou para uso offline.
                Nada é apagado do SharePoint: a biblioteca continua lá e você
                pode reconectar quando quiser.
              </>
            )}
          </AlertDialogDescription>
        </div>

        {/* Numeros */}
        <div className="space-y-3 p-4">
          {cartoes.map((c) => (
            <Cartao
              key={c.titulo}
              icone={c.icone}
              titulo={c.titulo}
              descricao={c.descricao}
              valor={c.valor}
            />
          ))}
        </div>

        {/* Rodape */}
        <AlertDialogFooter className="mx-0 mb-0 grid grid-cols-1 gap-2 p-4">
          {conectando && (
            <TooltipProvider>
              <Field orientation="horizontal" className="mb-1 w-auto">
                <Checkbox
                  id="pular-confirmacao"
                  checked={pular}
                  onCheckedChange={(v) => onPularChange(v === true)}
                />
                <div className="flex items-center gap-1.5">
                  <FieldLabel htmlFor="pular-confirmacao">
                    Não pedir confirmação novamente
                  </FieldLabel>
                  <Tooltip>
                    <TooltipTrigger className="text-muted-foreground">
                      <HelpCircleIcon aria-hidden="true" className="size-3.5" />
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      Nas próximas vezes, a biblioteca conecta direto ao ligar a
                      chave. Dá para reativar o aviso em Configurações.
                    </TooltipContent>
                  </Tooltip>
                </div>
              </Field>
            </TooltipProvider>
          )}
          <AlertDialogAction
            variant={conectando ? "default" : "destructive"}
            className="flex-1"
            onClick={onConfirmar}
          >
            {conectando ? "Continuar" : "Remover biblioteca"}
          </AlertDialogAction>
          <AlertDialogCancel variant="ghost" className="flex-1">
            {conectando ? "Deixar pra depois" : "Cancelar"}
          </AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
