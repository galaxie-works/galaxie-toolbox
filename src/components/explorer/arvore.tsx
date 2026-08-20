import { useCallback, useState, type ElementType, type ReactNode } from "react";
import { Cloud, Disc, HardDrive, House, Monitor, Network, Pin, Usb } from "lucide-react";

import {
  Files,
  FolderItem,
  FolderTrigger,
  FolderContent,
} from "@/components/animate-ui/components/radix/files";
import { ComMenu } from "./menu-contexto";
import {
  getTreeContextMenu,
  type AcoesMenu,
  type Clipboard,
  type ItemMenu,
  type RotulosMenu,
  type TipoNoArvore,
} from "./menu-arquivo";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { useIdioma } from "@/lib/idioma";
import { listarDir } from "@/lib/api";
import type {
  CloudLocation,
  DriveInfo,
  FsEntry,
  NetworkLocation,
} from "@/lib/types";
import {
  CAMINHO_ACESSO_RAPIDO,
  CAMINHO_CLOUD,
  CAMINHO_ESTE_PC,
  CAMINHO_REDE, pathPai,} from "./caminho";
import { estaFixado, mesmoCaminho, type PinAcessoRapido } from "./quick-access";
import { rotuloDrive } from "./rotulo-drive";
import { TooltipAcao } from "./tooltip-acao";

// #869: valores-sentinela dos nós-RAIZ do accordion (This PC / Acesso rápido).
// Não são caminhos reais — o prefixo "::" nunca colide com um caminho Windows (só
// existe ':' logo após a letra do drive), então dá pra distinguir uma raiz
// ESTÁTICA (filhos vêm por prop) de um caminho LAZY (filhos vêm do disco) só pelo
// valor, sem uma flag extra por nó.
const RAIZ_ESTE_PC = "::este-pc::";
// #1287: as outras raízes usam a MESMA sentinela como `value` do accordion e
// como `navPath` (o clique no cabeçalho navega pra view de tiles) — fonte única
// em `caminho.ts`, então o header ativo casa com o `currentPath` da view.
const RAIZ_ACESSO_RAPIDO = CAMINHO_ACESSO_RAPIDO;
const RAIZ_CLOUD = CAMINHO_CLOUD;
const RAIZ_REDE = CAMINHO_REDE;

/** Um valor de accordion é "lazy" (carrega filhos do disco ao abrir) quando é um
 *  caminho real; as raízes estáticas usam o prefixo-sentinela "::". */
function ehLazy(value: string): boolean {
  return !value.startsWith("::");
}

/** Sintetiza um `FsEntry` de pasta para um drive-root (nó da árvore). */
function driveParaEntry(d: DriveInfo): FsEntry {
  return {
    // #1288: mesmo defeito de letra dupla que o `drives-view` tinha — o nome
    // de drive de REDE já vem com a letra do redirector. O helper resolve.
    name: rotuloDrive(d.name, d.path),
    path: d.path,
    isDir: true,
    isSymlink: false,
    size: 0,
    modifiedMs: null,
    createdMs: null,
    extension: null,
    isHidden: false,
    isReadonly: false,
  };
}

/**
 * #1386: o que a árvore precisa pra montar o menu ACIONAVEL de um nó.
 *
 * Os handlers são os MESMOS do content-pane — o AC pede REUSO, não uma segunda
 * implementação (dois menus separados divergem, e a divergência é o próximo
 * bug). O painel publica seu `AcoesMenu` pro shell; o shell entrega aqui.
 */
export interface MenuArvore {
  /**
   * As ações do painel, lidas NO ATO de abrir o menu — elas trocam de
   * identidade a cada render do painel, então guardá-las em estado (e
   * re-renderizar a árvore por isso) fecharia um laço. `null` = nenhum painel
   * montado ainda (This PC, boot) → menu só de fixar/desafixar.
   */
  obterAcoes: () => AcoesMenu | null;
  rotulos: RotulosMenu;
  clipboard: Clipboard | null;
  /**
   * Navega até `dir` e SÓ ENTÃO age. Três das treze ações são presas à VIEW do
   * painel: `renomear` acende o input inline NA LINHA da lista, e `novaPasta`/
   * `novoArquivo` tiram o nome único das `entradas` CARREGADAS. Disparadas de
   * fora sem navegar, ou não apareceriam ou checariam colisão na pasta errada.
   * As outras dez operam por CAMINHO e agem sem tirar o usuário do lugar —
   * clicar "Copiar" numa pasta da árvore não deve mudar o que ele está vendo.
   */
  navegarEAgir: (dir: string, agir: (acoes: AcoesMenu) => void) => void;
}

/** Envolve as três presas à view; as outras dez passam intactas. */
function acoesDaArvore(menu: MenuArvore, acoes: AcoesMenu): AcoesMenu {
  return {
    ...acoes,
    // O input de rename mora na listagem do PAI — é pra lá que o painel vai.
    renomear: (e) => menu.navegarEAgir(pathPai(e.path), (a) => a.renomear(e)),
    novaPasta: (dir) => menu.navegarEAgir(dir, (a) => a.novaPasta(dir)),
    novoArquivo: (dir) => menu.navegarEAgir(dir, (a) => a.novoArquivo(dir)),
  };
}

/**
 * #869 (item 3): o logo do SERVIÇO em cada mount de nuvem.
 *
 * O código antes usava o `Cloud` genérico pra todos, com a justificativa
 * "sem arte por provider, nao-inventar-ui". A justificativa caiu quando eu medi:
 * os ativos JÁ ESTÃO no repo (`public/app-icons/onedrive.svg` e
 * `google-drive.svg`), usados pelo catálogo de apps. Usar o que já existe não é
 * inventar UI.
 *
 * Os componentes são ESTÁTICOS, de propósito: criar o componente dentro do
 * render faria o React remontar a imagem a cada passada (identidade nova a cada
 * vez), e num accordion isso pisca.
 *
 * `alt=""` + `aria-hidden`: o nome do mount já está no rótulo ao lado, então a
 * imagem é decorativa. Repetir "OneDrive" pro leitor de tela seria ruído.
 */
function LogoNuvem({ id, className }: { id: string; className?: string }) {
  return (
    <img
      src={`/app-icons/${id}.svg`}
      alt=""
      aria-hidden
      className={cn("size-4 shrink-0", className)}
    />
  );
}

const LogoOneDrive = ({ className }: { className?: string }) => (
  <LogoNuvem id="onedrive" className={className} />
);
const LogoGoogleDrive = ({ className }: { className?: string }) => (
  <LogoNuvem id="google-drive" className={className} />
);

/** Logo do provider; `Cloud` genérico se algum provider novo aparecer. */
function iconeDoProvider(provider: CloudLocation["provider"]): ElementType {
  switch (provider) {
    case "onedrive":
    case "onedriveCommercial":
      return LogoOneDrive;
    case "googledrive":
      return LogoGoogleDrive;
    default:
      return Cloud;
  }
}

/**
 * #1288: `FsEntry` para um ATALHO de rede (`.lnk` de `Network Shortcuts`).
 *
 * Diferente do drive mapeado, ele não tem letra — e era por isso que sumia:
 * a seção montava só de `drives.filter(kind === "network")`, e quem não tem
 * letra não está em `drives`.
 *
 * `available: false` NÃO esconde a entrada — o backend já decidiu isso de
 * propósito (`types.ts:661`: "a entrada CONTINUA na lista"). Filtrar aqui
 * seria desfazer aquela decisão em silêncio.
 */
function redeParaEntry(n: NetworkLocation): FsEntry {
  return {
    name: n.name,
    path: n.path,
    isDir: true,
    isSymlink: false,
    size: 0,
    modifiedMs: null,
    createdMs: null,
    extension: null,
    isHidden: false,
    isReadonly: false,
  };
}

/** #869: `FsEntry` de pasta para um mount de nuvem (nó da seção "Cloud drives"). */
function cloudParaEntry(c: CloudLocation): FsEntry {
  return {
    name: c.name,
    path: c.path,
    isDir: true,
    isSymlink: false,
    size: 0,
    modifiedMs: null,
    createdMs: null,
    extension: null,
    isHidden: false,
    isReadonly: false,
  };
}

/**
 * #869: ícone lucide por tipo de drive — HardDrive p/ locais (fixed/ramdisk/
 * unknown), Network p/ rede, Cloud p/ mount de nuvem, Usb p/ removível, Disc p/
 * CD/DVD. Só os DRIVES/mounts trocam o ícone; pastas comuns seguem no folder.
 */
function iconePorKind(kind: DriveInfo["kind"]): ElementType {
  switch (kind) {
    case "network":
      return Network;
    case "cloud":
      return Cloud;
    case "removable":
      return Usb;
    case "cdrom":
      return Disc;
    default:
      return HardDrive;
  }
}

/**
 * #869: árvore ÚNICA do sidebar do Explorer, renderizada pelo componente `Files`
 * do animate-ui (Radix Accordion `type="multiple"`) em modo CONTROLADO — um único
 * `open: string[]` compartilhado por toda a árvore, chaveado pelo valor do nó
 * (caminho completo p/ pastas; sentinela p/ as raízes). Estrutura:
 *
 *   Este computador (raiz)  →  drives  →  pastas (lazy, recursivo)
 *   Acesso rápido  (raiz)   →  pastas conhecidas  →  pastas (lazy, recursivo)
 *
 * As RAÍZES têm filhos estáticos (drives/`dirsConhecidos`, já carregados); só as
 * PASTAS carregam sob demanda: ao expandir um caminho ainda não lido, dispara
 * `listarDir`, guarda só as PASTAS (`isDir`) em `filhosPorPath` e mostra o spinner
 * enquanto `carregando` tem o caminho. Só pastas na árvore — arquivos ficam pro
 * painel de conteúdo. (#677 substituiu o `LocaisSidebar` flat: This PC/drives/
 * Acesso rápido agora são nós desta mesma árvore, não `SidebarNavItem` soltos.)
 */
export function ArvoreArquivos({
  drives,
  cloudLocations,
  networkLocations,
  acessoRapido,
  pins,
  onAlternarFixar,
  onRemoverAcessoRapido,
  homePath,
  currentPath,
  onNavegar,
  menu,
}: {
  drives: DriveInfo[];
  cloudLocations: CloudLocation[] | null;
  /** #1288: atalhos de rede (sem letra) — `null` enquanto carrega/degrada. */
  networkLocations: NetworkLocation[] | null;
  acessoRapido: FsEntry[] | null;
  // #869: pins do usuário (persistidos) — cada `NoArvore` checa `estaFixado` de
  // forma SÍNCRONA pra rotular o item do menu; e `onAlternarFixar` fixa/desafixa.
  pins: PinAcessoRapido[];
  onAlternarFixar: (entry: FsEntry) => void;
  // #1285 (A): remove um item do Acesso rápido (pin → desafixa; sistema → oculta).
  // Só os itens DE TOPO da seção Quick access recebem — os filhos lazy seguem com
  // o toggle Fixar normal.
  onRemoverAcessoRapido: (entry: FsEntry) => void;
  // #1285 (B): caminho da home (1º de dirsConhecidos) — o item correspondente no
  // Quick access vira "Home"/"Início" com ícone House, em vez do nome cru da pasta.
  homePath: string | null;
  currentPath: string;
  onNavegar: (path: string) => void;
  // #1386: ações do content-pane pro menu de contexto dos nós. Opcional — sem
  // ele a árvore segue com o menu de fixar/desafixar que sempre teve.
  menu?: MenuArvore;
}) {
  const { t } = useIdioma();
  // As raízes começam ABERTAS — drives, nuvem, rede e acesso rápido ficam visíveis
  // de cara, como no sidebar antigo; só as PASTAS é que carregam ao expandir.
  // Manter um sentinela em `open` sem FolderItem correspondente (ex.: seção de
  // nuvem/rede ausente) é inofensivo — o Radix ignora valores desconhecidos.
  const [open, setOpen] = useState<string[]>(() => [
    RAIZ_ESTE_PC,
    RAIZ_CLOUD,
    RAIZ_REDE,
    RAIZ_ACESSO_RAPIDO,
  ]);
  // #869: separa locais de rede (kind `network`) dos demais — cada grupo vira uma
  // seção-irmã (This PC só locais/removíveis/etc.; "Locais de rede" à parte).
  const drivesLocais = drives.filter((d) => d.kind !== "network");
  const drivesRede = drives.filter((d) => d.kind === "network");
  const [filhosPorPath, setFilhosPorPath] = useState<Map<string, FsEntry[]>>(
    () => new Map(),
  );
  const [carregando, setCarregando] = useState<Set<string>>(() => new Set());

  const carregar = useCallback(async (path: string) => {
    setCarregando((prev) => new Set(prev).add(path));
    try {
      const entradas = await listarDir(path);
      const pastas = entradas.filter((e) => e.isDir);
      setFilhosPorPath((prev) => new Map(prev).set(path, pastas));
    } catch {
      // Falha de leitura (permissão negada / caminho sumiu): registra vazio pra o
      // spinner sumir e a árvore não girar pra sempre.
      setFilhosPorPath((prev) => new Map(prev).set(path, []));
    } finally {
      setCarregando((prev) => {
        const proximo = new Set(prev);
        proximo.delete(path);
        return proximo;
      });
    }
  }, []);

  const aoAbrir = useCallback(
    (novo: string[]) => {
      const adicionados = novo.filter((p) => !open.includes(p));
      setOpen(novo);
      for (const p of adicionados) {
        // Só caminhos reais carregam do disco; sentinelas de raiz têm filhos
        // estáticos e nunca vão pro `filhosPorPath`.
        if (ehLazy(p) && !filhosPorPath.has(p) && !carregando.has(p)) {
          void carregar(p);
        }
      }
      // #991 (correção do Wagner): expandir pelo chevron NÃO navega. Antes um
      // clique na pasta expandia E navegava, despejando as subpastas inline; agora
      // o chevron só abre/fecha na árvore, e a navegação é só pelo clique no label.
    },
    [open, filhosPorPath, carregando, carregar],
  );

  return (
    <Files open={open} onOpenChange={aoAbrir} className="p-0">
      {/* Raiz "Este computador" → drives (estáticos) → pastas (lazy). Clicar o
          cabeçalho navega pro This PC (grade de drives, #855). */}
      <SecaoRaiz
        value={RAIZ_ESTE_PC}
        label={t.arquivos.drives}
        navPath={CAMINHO_ESTE_PC}
        icon={Monitor}
        currentPath={currentPath}
        onNavegar={onNavegar}
      >
        {drivesLocais.map((d) => (
          <NoArvore
            key={d.path}
            entry={driveParaEntry(d)}
            icone={iconePorKind(d.kind)}
            menu={menu}
            tipoNo="drive"
            filhosPorPath={filhosPorPath}
            carregando={carregando}
            currentPath={currentPath}
            onNavegar={onNavegar}
            pins={pins}
            onAlternarFixar={onAlternarFixar}
            fixarLabel={t.arquivos.fixarAcessoRapido}
            desafixarLabel={t.arquivos.desafixarAcessoRapido}
            carregandoLabel={t.arquivos.carregando}
            vazioLabel={t.arquivos.vazio}
          />
        ))}
      </SecaoRaiz>

      {/* #869: "Cloud drives" — mounts de nuvem locais (OneDrive/Google Drive). Só
          renderiza quando há ≥1 mount; logo do serviço em cada mount (#869
          item 3 — os ativos já existiam no repo). Cada item é pasta lazy (navega pro `path`). */}
      {cloudLocations && cloudLocations.length > 0 && (
        <SecaoRaiz
          value={RAIZ_CLOUD}
          label={t.arquivos.driveSecaoCloud}
          navPath={CAMINHO_CLOUD}
          icon={Cloud}
          currentPath={currentPath}
          onNavegar={onNavegar}
        >
          {cloudLocations.map((c) => (
            <NoArvore
              key={c.path}
              entry={cloudParaEntry(c)}
              icone={iconeDoProvider(c.provider)}
              menu={menu}
              tipoNo="drive"
              filhosPorPath={filhosPorPath}
              carregando={carregando}
              currentPath={currentPath}
              onNavegar={onNavegar}
              pins={pins}
              onAlternarFixar={onAlternarFixar}
              fixarLabel={t.arquivos.fixarAcessoRapido}
              desafixarLabel={t.arquivos.desafixarAcessoRapido}
              carregandoLabel={t.arquivos.carregando}
              vazioLabel={t.arquivos.vazio}
            />
          ))}
        </SecaoRaiz>
      )}

      {/* #869/#1288: "Locais de rede" — drives mapeados (`kind==="network"`) E
          atalhos sem letra (`Network Shortcuts`), na MESMA seção, como o Explorer
          do Windows faz. Antes só os mapeados apareciam: a seção montava de
          `drives.filter(...)`, e atalho sem letra não está em `drives`. */}
      {(drivesRede.length > 0 || (networkLocations?.length ?? 0) > 0) && (
        <SecaoRaiz
          value={RAIZ_REDE}
          label={t.arquivos.driveSecaoRede}
          navPath={CAMINHO_REDE}
          icon={Network}
          currentPath={currentPath}
          onNavegar={onNavegar}
        >
          {[
            ...drivesRede.map((d) => driveParaEntry(d)),
            ...(networkLocations ?? []).map((n) => redeParaEntry(n)),
          ]
            // Ordem por nome, como o Explorer: o usuário não precisa saber se
            // aquilo é drive mapeado ou atalho pra achar o que procura.
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((entry) => (
            <NoArvore
              key={entry.path}
              entry={entry}
              icone={Network}
              menu={menu}
              tipoNo="drive"
              filhosPorPath={filhosPorPath}
              carregando={carregando}
              currentPath={currentPath}
              onNavegar={onNavegar}
              pins={pins}
              onAlternarFixar={onAlternarFixar}
              fixarLabel={t.arquivos.fixarAcessoRapido}
              desafixarLabel={t.arquivos.desafixarAcessoRapido}
              carregandoLabel={t.arquivos.carregando}
              vazioLabel={t.arquivos.vazio}
            />
          ))}
        </SecaoRaiz>
      )}

      {/* #869: "Acesso rápido" como raiz-IRMÃ na MESMA árvore (dados de
          `dirsConhecidos`). Os itens são pastas — expansíveis/lazy como as demais.
          #1287: o cabeçalho navega pra view de tiles do Acesso rápido. */}
      {acessoRapido && acessoRapido.length > 0 && (
        <SecaoRaiz
          value={RAIZ_ACESSO_RAPIDO}
          label={t.arquivos.acessoRapido}
          navPath={CAMINHO_ACESSO_RAPIDO}
          icon={Pin}
          currentPath={currentPath}
          onNavegar={onNavegar}
        >
          {acessoRapido.map((e) => {
            // #1285 (B): a home vira "Home"/"Início" + ícone House. Rótulo trocado
            // por override do `name` (o `path` — navegação e chave — não muda).
            const ehHome = homePath !== null && mesmoCaminho(e.path, homePath);
            const item = ehHome ? { ...e, name: t.arquivos.home } : e;
            return (
              <NoArvore
                key={e.path}
                entry={item}
                icone={ehHome ? House : undefined}
                menu={menu}
                tipoNo="pasta"
                filhosPorPath={filhosPorPath}
                carregando={carregando}
                currentPath={currentPath}
                onNavegar={onNavegar}
                pins={pins}
                onAlternarFixar={onAlternarFixar}
                // #1285 (A): item de topo do Quick access → menu "Desafixar" que
                // remove (pin ou oculta). Os filhos NÃO recebem `acaoRemover`.
                acaoRemover={onRemoverAcessoRapido}
                fixarLabel={t.arquivos.fixarAcessoRapido}
                desafixarLabel={t.arquivos.desafixarAcessoRapido}
                carregandoLabel={t.arquivos.carregando}
                vazioLabel={t.arquivos.vazio}
              />
            );
          })}
        </SecaoRaiz>
      )}
    </Files>
  );
}

/**
 * #869: nó-RAIZ do sidebar (Este computador / Acesso rápido). Difere do `NoArvore`
 * em dois pontos: os filhos são ESTÁTICOS (vêm por prop, não do disco) e o
 * cabeçalho só navega quando recebe um `navPath` (This PC → grade de drives;
 * Acesso rápido é só um rótulo, sem caminho). O padrão do container-que-navega é o
 * mesmo do `NoArvore` (o `FolderTrigger` é `pointer-events-none`).
 */
function SecaoRaiz({
  value,
  label,
  navPath,
  icon,
  currentPath,
  onNavegar,
  children,
}: {
  value: string;
  label: string;
  navPath?: string;
  // #1285 (C): ícone da raiz. Sem `icon`, o `FolderTrigger` usa o de pasta
  // (comportamento das seções sem ícone semântico). This PC passa `Monitor`.
  icon?: ElementType;
  currentPath: string;
  onNavegar: (path: string) => void;
  children: ReactNode;
}) {
  const { t } = useIdioma();
  const ativo = navPath !== undefined && currentPath === navPath;
  return (
    <FolderItem value={value}>
      {navPath !== undefined ? (
        <div
          onClick={() => onNavegar(navPath)}
          className={cn("rounded-md", ativo && "bg-secondary")}
        >
          <FolderTrigger expandLabel={t.arquivos.expandirColapsar} icon={icon}>
            {label}
          </FolderTrigger>
        </div>
      ) : (
        <FolderTrigger expandLabel={t.arquivos.expandirColapsar} icon={icon}>
          {label}
        </FolderTrigger>
      )}
      <FolderContent>{children}</FolderContent>
    </FolderItem>
  );
}

function NoArvore({
  entry,
  icone,
  filhosPorPath,
  carregando,
  currentPath,
  onNavegar,
  pins,
  onAlternarFixar,
  acaoRemover,
  fixarLabel,
  desafixarLabel,
  carregandoLabel,
  vazioLabel,
  menu,
  tipoNo = "pasta",
}: {
  entry: FsEntry;
  // #869: ícone só do nó-raiz do seu grupo (drive/mount de nuvem). Os filhos
  // recursivos (pastas comuns) NÃO recebem — caem no folder padrão.
  icone?: ElementType;
  filhosPorPath: Map<string, FsEntry[]>;
  carregando: Set<string>;
  currentPath: string;
  onNavegar: (path: string) => void;
  pins: PinAcessoRapido[];
  onAlternarFixar: (entry: FsEntry) => void;
  // #1285 (A): quando presente (item de TOPO do Quick access), o menu vira
  // "Desafixar" e chama isto — remove o item (pin ou oculta o de sistema). NÃO
  // é repassado aos filhos, então pasta interna segue com o toggle Fixar normal.
  acaoRemover?: (entry: FsEntry) => void;
  fixarLabel: string;
  desafixarLabel: string;
  carregandoLabel: string;
  vazioLabel: string;
  // #1386: ações do painel; ausente = menu só de fixar/desafixar.
  menu?: MenuArvore;
  // #1283 B: drive perde o que destrói/move ele mesmo (Recortar/Renomear/
  // Excluir). Filho recursivo é sempre pasta de verdade.
  tipoNo?: TipoNoArvore;
}) {
  const { t } = useIdioma();
  const filhos = filhosPorPath.get(entry.path);
  const estaCarregando = carregando.has(entry.path);
  const ativo = currentPath === entry.path;
  // #869: pin é checado de forma SÍNCRONA a cada render (lê o array persistido) —
  // o item do ContextMenu já sabe o rótulo certo no ATO de abrir, sem estado
  // async (lição do P0 #778: conteúdo de menu Radix presente/decidido na abertura).
  const fixado = estaFixado(pins, entry.path);

  // #1386: os itens são montados DURANTE o render (o `ComMenu` avalia a thunk),
  // como no conteúdo — o Radix precisa dos filhos já montados quando abre, era
  // o #778. `shift` chega do clique direito e troca Lixeira por permanente.
  const itensMenu = (shift: boolean): ItemMenu[] => {
    // #1285 (A): item de TOPO do Quick access é sempre "Desafixar" — remove o
    // pin ou oculta o de sistema. Os filhos caem no toggle normal.
    const pin = acaoRemover
      ? { fixado: true, rotulo: desafixarLabel, aoAlternar: () => acaoRemover(entry) }
      : {
          fixado,
          rotulo: fixado ? desafixarLabel : fixarLabel,
          aoAlternar: () => onAlternarFixar(entry),
        };
    const acoes = menu ? menu.obterAcoes() : null;
    if (!menu || !acoes) {
      return [
        {
          id: "fixar",
          label: pin.rotulo,
          icon: pin.fixado ? "desafixar" : "fixar",
          onClick: pin.aoAlternar,
        },
      ];
    }
    return getTreeContextMenu(
      entry,
      tipoNo,
      menu.clipboard,
      acoesDaArvore(menu, acoes),
      menu.rotulos,
      pin,
      { permanente: shift },
    );
  };

  return (
    <FolderItem value={entry.path}>
      {/* #1386: o MESMO `ComMenu` do conteúdo (mesmo renderizador de `ItemMenu`,
          mesmo aninhamento Radix) — o menu da árvore deixou de ser feito à mão.
          O clique-esquerdo navega; o direito abre. O conteúdo do `FolderTrigger`
          do animate-ui é `pointer-events-none`, então o clique cai no botão do
          acordeão e o container por fora captura o MESMO clique por bubbling pra
          também NAVEGAR. Sem lint de a11y no projeto; o gatilho por baixo é um
          <button> real (teclado cobre via `aoAbrir`). */}
      <ComMenu
        itens={itensMenu}
        onClick={() => onNavegar(entry.path)}
        className={cn("rounded-md", ativo && "bg-secondary")}
      >
        <FolderTrigger icon={icone} expandLabel={t.arquivos.expandirColapsar}>
          {entry.name}
        </FolderTrigger>
      </ComMenu>
      <FolderContent>
        {estaCarregando ? (
          <div className="flex items-center gap-2 p-2">
            <Spinner className="size-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">
              {carregandoLabel}
            </span>
          </div>
        ) : filhos && filhos.length > 0 ? (
          filhos.map((f) => (
            <NoArvore
              key={f.path}
              entry={f}
              filhosPorPath={filhosPorPath}
              carregando={carregando}
              currentPath={currentPath}
              onNavegar={onNavegar}
              pins={pins}
              onAlternarFixar={onAlternarFixar}
              menu={menu}
              fixarLabel={fixarLabel}
              desafixarLabel={desafixarLabel}
              carregandoLabel={carregandoLabel}
              vazioLabel={vazioLabel}
            />
          ))
        ) : filhos ? (
          <p className="p-2 text-xs text-muted-foreground">{vazioLabel}</p>
        ) : null}
      </FolderContent>
    </FolderItem>
  );
}

/**
 * #869 (adendo de layout do Wagner): o RAIL — o que o sidebar vira quando
 * colapsa. Só ícones, e cada um com o tooltip do caption, que é o pedido
 * literal: *"colapsado, hover em cada drive/pasta mostra o tooltip com o nome"*.
 *
 * O que entra: os DESTINOS de navegação de primeiro nível — Este computador,
 * cada drive local, cada mount de nuvem, cada local de rede e cada item do
 * acesso rápido. As pastas-filhas ficam de fora de propósito: são lazy e só
 * existem depois de expandir um nó que, colapsado, não existe.
 *
 * Reusa `iconePorKind` e os mesmos rótulos da árvore — se o ícone de um tipo de
 * drive mudar lá, muda aqui junto.
 */
export function RailArvore({
  drives,
  cloudLocations,
  networkLocations,
  acessoRapido,
  currentPath,
  onNavegar,
}: {
  drives: DriveInfo[];
  cloudLocations: CloudLocation[] | null;
  networkLocations: NetworkLocation[] | null;
  acessoRapido: FsEntry[] | null;
  currentPath: string;
  onNavegar: (path: string) => void;
}) {
  const { t } = useIdioma();
  const itens: { path: string; label: string; icone: ElementType }[] = [
    {
      path: CAMINHO_ESTE_PC,
      label: t.arquivos.drives,
      icone: Monitor,
    },
    ...drives
      .filter((d) => d.kind !== "network")
      .map((d) => ({
        path: d.path,
        label: driveParaEntry(d).name,
        icone: iconePorKind(d.kind),
      })),
    ...(cloudLocations ?? []).map((c) => ({
      path: c.path,
      label: cloudParaEntry(c).name,
      icone: Cloud as ElementType,
    })),
    ...drives
      .filter((d) => d.kind === "network")
      .map((d) => ({
        path: d.path,
        label: driveParaEntry(d).name,
        icone: Network as ElementType,
      })),
    // #1288: atalhos de rede sem letra tambem sao destino — colapsado o usuario
    // precisa alcanca-los igual.
    ...(networkLocations ?? []).map((n) => ({
      path: n.path,
      label: n.name,
      icone: Network as ElementType,
    })),
    ...(acessoRapido ?? []).map((e) => ({
      path: e.path,
      label: e.name,
      icone: Pin as ElementType,
    })),
  ];

  return (
    <div className="flex flex-col items-center gap-1 py-1">
      {itens.map(({ path, label, icone: Icone }) => (
        <TooltipAcao key={path || "::este-pc::"} label={label}>
          <button
            type="button"
            aria-label={label}
            onClick={() => onNavegar(path)}
            className={cn(
              "grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground",
              "hover:bg-accent hover:text-foreground",
              path === currentPath && "bg-accent text-foreground",
            )}
          >
            <Icone className="size-4" />
          </button>
        </TooltipAcao>
      ))}
    </div>
  );
}
